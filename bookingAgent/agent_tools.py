"""LangGraph state schema and booking-related tools."""

from __future__ import annotations

from datetime import datetime, timedelta
from math import ceil
from typing import Any, Literal

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages
from typing_extensions import Annotated, TypedDict

from database import DATETIME_FMT, SLOT_MINUTES, get_connection


class BookingAgentState(TypedDict):
	messages: Annotated[list[AnyMessage], add_messages]
	current_intent: dict[str, Any]
	booking_status: Literal[
		"pending",
		"conflict",
		"confirmed",
		"needs_clarification",
		"error",
		"rescheduled",
		"cancelled",
	]
	conflict_suggestions: list[str]


def _parse_datetime(value: str) -> datetime:
	return datetime.strptime(value, DATETIME_FMT)


def _to_datetime_str(value: datetime) -> str:
	return value.strftime(DATETIME_FMT)


def _ensure_calendar_span(start_time: str, end_time: str) -> None:
	"""Ensure calendar has 30-minute rows covering the requested window."""
	start_dt = _parse_datetime(start_time)
	end_dt = _parse_datetime(end_time)
	if end_dt <= start_dt:
		return

	missing: list[tuple[str, str, str, None]] = []
	cursor = start_dt
	with get_connection() as conn:
		while cursor < end_dt:
			slot_end = cursor + timedelta(minutes=SLOT_MINUTES)
			start_str = _to_datetime_str(cursor)
			row = conn.execute(
				"SELECT 1 FROM calendar WHERE start_datetime = ? LIMIT 1",
				(start_str,),
			).fetchone()
			if not row:
				missing.append((start_str, _to_datetime_str(slot_end), "free", None))
			cursor = slot_end

		if missing:
			conn.executemany(
				"""
				INSERT INTO calendar (start_datetime, end_datetime, status, event_details)
				VALUES (?, ?, ?, ?)
				""",
				missing,
			)
			conn.commit()


def _gather_booked_windows() -> list[dict[str, Any]]:
	with get_connection() as conn:
		rows = conn.execute(
			"""
			SELECT start_datetime, end_datetime, event_details
			FROM calendar
			WHERE status = 'booked'
			ORDER BY start_datetime ASC
			"""
		).fetchall()

	if not rows:
		return []

	windows: list[dict[str, Any]] = []
	for row in rows:
		start = _parse_datetime(row["start_datetime"])
		end = _parse_datetime(row["end_datetime"])
		details = row["event_details"] or "Booking via AI assistant"

		if not windows:
			windows.append({"start": start, "end": end, "details": details})
			continue

		last = windows[-1]
		if last["details"] == details and last["end"] == start:
			last["end"] = end
		else:
			windows.append({"start": start, "end": end, "details": details})

	for window in windows:
		window["start_text"] = _to_datetime_str(window["start"])
		window["end_text"] = _to_datetime_str(window["end"])
		window["details_normalized"] = window["details"].strip().lower()

	return windows


def find_matching_bookings(
	details_hint: str | None = None,
	start_time_hint: str | None = None,
) -> list[dict[str, Any]]:
	"""Return booked windows matching provided hints."""
	windows = _gather_booked_windows()
	if not windows:
		return []

	filtered = windows
	if details_hint:
		norm = details_hint.strip().lower()
		filtered = [w for w in filtered if w["details_normalized"] == norm]

	if start_time_hint:
		try:
			start_dt = _parse_datetime(start_time_hint)
		except ValueError:
			start_dt = None
		if start_dt is not None:
			exact = [w for w in filtered if w["start"] == start_dt]
			if exact:
				return exact
			target_time = start_dt.time()
			filtered = [w for w in filtered if w["start"].time() == target_time]

	return filtered


def check_availability(start_time: str, end_time: str) -> dict[str, Any]:
	"""Check if every slot in a requested interval is free."""
	start_dt = _parse_datetime(start_time)
	end_dt = _parse_datetime(end_time)

	if end_dt <= start_dt:
		return {
			"available": False,
			"reason": "End time must be later than start time.",
		}

	_ensure_calendar_span(start_time, end_time)

	with get_connection() as conn:
		conflict_count_row = conn.execute(
			"""
			SELECT COUNT(*) AS conflict_count
			FROM calendar
			WHERE status = 'booked'
			  AND start_datetime < ?
			  AND end_datetime > ?
			""",
			(end_time, start_time),
		).fetchone()

		if conflict_count_row and conflict_count_row["conflict_count"] > 0:
			return {
				"available": False,
				"reason": "Requested window overlaps an existing booking.",
			}

		free_rows = conn.execute(
			"""
			SELECT start_datetime
			FROM calendar
			WHERE status = 'free'
			  AND start_datetime >= ?
			  AND end_datetime <= ?
			ORDER BY start_datetime
			""",
			(start_time, end_time),
		).fetchall()

	free_slot_starts = {_parse_datetime(row["start_datetime"]) for row in free_rows}

	cursor = start_dt
	while cursor < end_dt:
		if cursor not in free_slot_starts:
			return {
				"available": False,
				"reason": "One or more requested slots are unavailable.",
			}
		cursor += timedelta(minutes=SLOT_MINUTES)

	return {
		"available": True,
		"reason": "All requested slots are free.",
		"slot_count": int((end_dt - start_dt).total_seconds() // (SLOT_MINUTES * 60)),
	}


def book_meeting(start_time: str, end_time: str, details: str) -> dict[str, Any]:
	"""Book all slots in a requested interval if currently free."""
	availability = check_availability(start_time, end_time)
	if not availability["available"]:
		return {
			"success": False,
			"message": f"Could not complete booking: {availability['reason']}",
		}

	with get_connection() as conn:
		cur = conn.execute(
			"""
			UPDATE calendar
			SET status = 'booked', event_details = ?
			WHERE start_datetime >= ?
			  AND end_datetime <= ?
			  AND status = 'free'
			""",
			(details, start_time, end_time),
		)
		conn.commit()

	if cur.rowcount <= 0:
		return {
			"success": False,
			"message": "No slots were updated. Another booking may have occurred.",
		}

	return {
		"success": True,
		"message": "Meeting confirmed.",
		"summary": {
			"start_time": start_time,
			"end_time": end_time,
			"details": details,
			"booked_slots": cur.rowcount,
		},
	}


def find_next_available_slots(
	start_time: str,
	duration_minutes: int,
	max_suggestions: int = 3,
) -> list[dict[str, str]]:
	"""Find the next contiguous free windows matching the requested duration."""
	required_slots = max(1, ceil(duration_minutes / SLOT_MINUTES))

	with get_connection() as conn:
		rows = conn.execute(
			"""
			SELECT start_datetime
			FROM calendar
			WHERE status = 'free'
			  AND start_datetime >= ?
			ORDER BY start_datetime
			""",
			(start_time,),
		).fetchall()

	free_starts = [_parse_datetime(row["start_datetime"]) for row in rows]
	free_start_set = set(free_starts)

	suggestions: list[dict[str, str]] = []
	seen_starts: set[datetime] = set()

	for candidate_start in free_starts:
		if candidate_start in seen_starts:
			continue

		contiguous = True
		for slot_idx in range(required_slots):
			slot_time = candidate_start + timedelta(minutes=SLOT_MINUTES * slot_idx)
			if slot_time not in free_start_set:
				contiguous = False
				break

		if contiguous:
			candidate_end = candidate_start + timedelta(
				minutes=SLOT_MINUTES * required_slots
			)
			suggestions.append(
				{
					"start": _to_datetime_str(candidate_start),
					"end": _to_datetime_str(candidate_end),
				}
			)
			seen_starts.add(candidate_start)

		if len(suggestions) >= max_suggestions:
			break

	return suggestions


def _slot_count(start_time: str, end_time: str) -> int:
	start = _parse_datetime(start_time)
	end = _parse_datetime(end_time)
	if end <= start:
		return 0
	return int((end - start).total_seconds() // (SLOT_MINUTES * 60))


def cancel_meeting(start_time: str, end_time: str) -> dict[str, Any]:
	"""Mark slots back to free for a previously booked window."""
	with get_connection() as conn:
		cur = conn.execute(
			"""
			UPDATE calendar
			SET status = 'free', event_details = NULL
			WHERE start_datetime >= ?
			  AND end_datetime <= ?
			  AND status = 'booked'
			""",
			(start_time, end_time),
		)
		conn.commit()

	if cur.rowcount <= 0:
		return {
			"success": False,
			"message": "No matching booking was found to cancel.",
		}

	return {
		"success": True,
		"message": "Booking cancelled.",
		"released_slots": cur.rowcount,
	}


def get_booked_window(start_time: str) -> dict[str, str] | None:
	"""Return the full contiguous window for a booking starting at start_time."""
	with get_connection() as conn:
		row = conn.execute(
			"""
			SELECT start_datetime, end_datetime, event_details, status
			FROM calendar
			WHERE start_datetime = ?
			""",
			(start_time,),
		).fetchone()

		if not row or row["status"] != "booked":
			return None

		details = row["event_details"] or "Booking via AI assistant"
		window_end = row["end_datetime"]
		next_start = window_end

		while True:
			next_row = conn.execute(
				"""
				SELECT start_datetime, end_datetime, event_details, status
				FROM calendar
				WHERE start_datetime = ?
				""",
				(next_start,),
			).fetchone()

			if (
				not next_row
				or next_row["status"] != "booked"
				or (next_row["event_details"] or details) != details
				or next_row["start_datetime"] != next_start
			):
				break

			window_end = next_row["end_datetime"]
			next_start = next_row["end_datetime"]

	return {
		"start": start_time,
		"end": window_end,
		"details": details,
	}


def reschedule_meeting(
	current_start: str,
	current_end: str,
	new_start: str,
	new_end: str,
	details: str,
) -> dict[str, Any]:
	"""Move an existing booking to a new free window."""
	if _slot_count(current_start, current_end) <= 0:
		return {
			"success": False,
			"message": "Original meeting window is invalid.",
		}

	if _slot_count(new_start, new_end) <= 0:
		return {
			"success": False,
			"message": "New meeting window is invalid.",
		}

	availability = check_availability(new_start, new_end)
	if not availability.get("available"):
		return {
			"success": False,
			"message": availability.get("reason", "Requested window is unavailable."),
		}

	with get_connection() as conn:
		conn.execute("BEGIN")
		released = conn.execute(
			"""
			UPDATE calendar
			SET status = 'free', event_details = NULL
			WHERE start_datetime >= ?
			  AND end_datetime <= ?
			  AND status = 'booked'
			""",
			(current_start, current_end),
		).rowcount

		if released <= 0:
			conn.execute("ROLLBACK")
			return {
				"success": False,
				"message": "Could not find the original booking to move.",
			}

		booked = conn.execute(
			"""
			UPDATE calendar
			SET status = 'booked', event_details = ?
			WHERE start_datetime >= ?
			  AND end_datetime <= ?
			  AND status = 'free'
			""",
			(details, new_start, new_end),
		).rowcount

		if booked <= 0:
			conn.execute("ROLLBACK")
			return {
				"success": False,
				"message": "Requested window became unavailable. Please try a different time.",
			}

		conn.commit()

	return {
		"success": True,
		"message": "Meeting rescheduled.",
		"summary": {
			"previous_start": current_start,
			"previous_end": current_end,
			"new_start": new_start,
			"new_end": new_end,
			"details": details,
			"slots_moved": booked,
		},
	}
