"""LangGraph workflow for conversational booking."""

from __future__ import annotations

import os
import re
from datetime import datetime, timedelta
from typing import Literal

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from agent_tools import (
    BookingAgentState,
    book_meeting,
    cancel_meeting,
    check_availability,
    find_next_available_slots,
    find_matching_bookings,
    get_booked_window,
    reschedule_meeting,
)


class ParsedIntent(BaseModel):
    action: Literal["book", "reschedule", "cancel", "unknown"] = Field(
        description=(
            "User intent. Use 'book' for new meetings, 'reschedule' to move an existing "
            "booking, and 'cancel' to remove a meeting."
        )
    )
    start_time: str | None = Field(
        default=None,
        description="Start datetime in format YYYY-MM-DD HH:MM:SS.",
    )
    end_time: str | None = Field(
        default=None,
        description="End datetime in format YYYY-MM-DD HH:MM:SS.",
    )
    existing_start_time: str | None = Field(
        default=None,
        description="Current booking start time when rescheduling.",
    )
    existing_end_time: str | None = Field(
        default=None,
        description="Current booking end time when rescheduling.",
    )
    event_details: str = Field(
        default="Booking via AI assistant",
        description="Short event description from user message.",
    )
    needs_clarification: bool = Field(
        default=False,
        description="True if the user request misses date/time information.",
    )
    clarification_question: str = Field(
        default="Could you share the exact date and time for the booking?",
        description="One follow-up question when clarification is needed.",
    )


def _to_datetime_text(value: datetime) -> str:
    return value.strftime("%Y-%m-%d %H:%M:%S")


def _from_datetime_text(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


MONTH_MAP = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}


def _parse_date_from_text(user_text: str, now: datetime) -> datetime.date:
    lowered = user_text.lower()
    if "tomorrow" in lowered:
        return (now + timedelta(days=1)).date()
    if "today" in lowered:
        return now.date()

    date_match = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", user_text)
    if date_match:
        return datetime.strptime(date_match.group(1), "%Y-%m-%d").date()

    month_first = re.search(
        r"\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?",
        lowered,
    )
    if month_first:
        month = MONTH_MAP[month_first.group(1)]
        day = int(month_first.group(2))
        year = int(month_first.group(3)) if month_first.group(3) else now.year
        return datetime(year=year, month=month, day=day).date()

    day_first = re.search(
        r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:,?\s+(\d{4}))?",
        lowered,
    )
    if day_first:
        day = int(day_first.group(1))
        month = MONTH_MAP[day_first.group(2)]
        year = int(day_first.group(3)) if day_first.group(3) else now.year
        return datetime(year=year, month=month, day=day).date()

    return now.date()


def _parse_time_token(token: str, base_date: datetime.date) -> datetime | None:
    text = token.strip().lower().replace(".", "")
    text = re.sub(r"\s+", " ", text)
    # Ensure space before am/pm for easier matching
    text = re.sub(r"([0-9])(am|pm)", r"\1 \2", text)

    formats = ["%I:%M %p", "%I %p", "%H:%M", "%H:%M:%S"]
    for fmt in formats:
        try:
            parsed = datetime.strptime(text.upper(), fmt)
            return datetime(
                year=base_date.year,
                month=base_date.month,
                day=base_date.day,
                hour=parsed.hour,
                minute=parsed.minute,
            )
        except ValueError:
            continue

    return None


def _extract_duration_minutes(user_text: str) -> int:
    lowered = user_text.lower()
    min_match = re.search(r"for\s+(\d{1,3})\s*(min|mins|minute|minutes)\b", lowered)
    if min_match:
        return int(min_match.group(1))

    hour_match = re.search(r"for\s+(\d{1,2})(?:\.(\d))?\s*(h|hr|hrs|hour|hours)\b", lowered)
    if hour_match:
        whole = int(hour_match.group(1))
        decimal = hour_match.group(2)
        if decimal:
            return int(float(f"{whole}.{decimal}") * 60)
        return whole * 60

    return 30


def _is_plain_greeting(user_text: str) -> bool:
    """Detect free-form greetings like "hi" or "good morning"."""
    sanitized = re.sub(r"[^a-z\s]", " ", user_text.lower())
    tokens = [token for token in sanitized.split() if token]
    if not tokens:
        return False

    greeting_roots = {
        "hi",
        "hello",
        "hey",
        "hiya",
        "heya",
        "howdy",
        "greetings",
        "salutations",
    }
    filler_tokens = {
        "there",
        "team",
        "folks",
        "everyone",
        "assistant",
        "bot",
        "agent",
        "good",
        "morning",
        "afternoon",
        "evening",
        "how",
        "are",
        "you",
        "doing",
        "today",
        "this",
        "fine",
        "what",
        "s",
        "up",
        "ya",
        "yall",
    }

    if not any(token in greeting_roots for token in tokens):
        return False

    return all(token in greeting_roots or token in filler_tokens for token in tokens)


def _parse_iso_like_datetime(fragment: str) -> datetime | None:
    normalized = fragment.replace("T", " ").strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(normalized, fmt)
        except ValueError:
            continue
    return None


def _collect_datetime_candidates(user_text: str, base_date: datetime.date) -> list[tuple[int, datetime]]:
    candidates: list[tuple[int, datetime]] = []

    for match in re.finditer(r"\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?", user_text):
        token = match.group(0)
        if ":" not in token:
            continue
        parsed = _parse_iso_like_datetime(token)
        if parsed:
            candidates.append((match.start(), parsed))

    time_pattern = re.compile(r"\b\d{1,2}(?::\d{2})?\s*(am|pm)\b", re.IGNORECASE)
    for match in time_pattern.finditer(user_text):
        token = match.group(0)
        parsed = _parse_time_token(token, base_date)
        if parsed:
            candidates.append((match.start(), parsed))

    military_pattern = re.compile(r"\b\d{1,2}:\d{2}\b")
    for match in military_pattern.finditer(user_text):
        token = match.group(0)
        parsed = _parse_time_token(token, base_date)
        if parsed:
            candidates.append((match.start(), parsed))

    candidates.sort(key=lambda item: item[0])

    deduped: list[tuple[int, datetime]] = []
    seen: set[str] = set()
    for position, value in candidates:
        key = _to_datetime_text(value)
        if key in seen:
            continue
        seen.add(key)
        deduped.append((position, value))

    return deduped


def _extract_event_title(user_text: str) -> str | None:
    pattern = re.compile(
        r"cancel(?: the)?\s+(.+?)(?:\s+(?:that|which|starting|begins|beginning|scheduled|at|on|for)\b|[\.,!?]|$)",
        re.IGNORECASE,
    )
    match = pattern.search(user_text)
    if not match:
        return None
    title = match.group(1).strip()
    if not title:
        return None
    return title


def _extract_booking_title(user_text: str) -> str | None:
    pattern = re.compile(
        r"(?:named|called|title(?:d)?)\s+[\"']?(.+?)[\"']?(?:\s+(?:on|at|for|from|to|starting|beginning|with|tomorrow|today|tonight|next)\b|[\.,!?]|$)",
        re.IGNORECASE,
    )
    match = pattern.search(user_text)
    if not match:
        return None
    title = match.group(1).strip().strip('\"\'')
    return title or None


def _derive_event_details(user_text: str, raw_details: str | None) -> str:
    candidate = (raw_details or "").strip()
    candidate = candidate.strip(" .,!?")
    if candidate:
        normalized = candidate.lower()
        if re.fullmatch(
            r"\d{1,3}(?:\.\d+)?\s*(?:min|mins|minute|minutes|hr|hrs|hour|hours|h)(?:\s+(?:long|duration))?",
            normalized,
        ):
            candidate = ""
        else:
            filler = {"tomorrow", "today", "at", "on", "the", "this", "next"}
            tokens = [t for t in normalized.split() if t not in filler]
            trailing_generic = {"meeting", "call", "sync", "discussion", "chat"}
            while tokens and tokens[-1] in trailing_generic:
                tokens.pop()
            if not tokens:
                candidate = ""
            else:
                candidate = " ".join(tokens)

    if candidate:
        return candidate

    fallback = _extract_booking_title(user_text)
    if fallback:
        return fallback

    return "Booking via AI assistant"


def _is_placeholder_detail(text: str) -> bool:
    if not text:
        return True
    normalized = text.strip().lower()
    if not normalized or normalized == "booking via ai assistant":
        return True

    filler = {
        "meeting",
        "call",
        "sync",
        "discussion",
        "appointment",
        "tomorrow",
        "today",
        "tonight",
        "next",
        "this",
        "at",
        "on",
        "the",
    }
    tokens = [token for token in re.split(r"\s+", normalized) if token]
    if not tokens:
        return True
    if all(token in filler for token in tokens):
        return True
    return False


def _enrich_event_details(intent: dict, user_text: str) -> dict:
    if not intent:
        return intent

    current = (intent.get("event_details") or "").strip()
    if current and not _is_placeholder_detail(current):
        return intent

    hint = None
    if intent.get("action") == "cancel":
        hint = _extract_event_title(user_text)
    else:
        hint = _extract_booking_title(user_text)

    if hint:
        intent["event_details"] = hint

    return intent


def _merge_cancel_followup(prior_intent: dict, user_text: str, now: datetime) -> dict | None:
    base_date = _parse_date_from_text(user_text, now)
    candidates = [value for _, value in _collect_datetime_candidates(user_text, base_date)]
    if not candidates:
        return None

    updated = {**prior_intent}
    updated["action"] = "cancel"
    start_dt = candidates[0]
    updated["start_time"] = _to_datetime_text(start_dt)
    if len(candidates) > 1:
        end_dt = candidates[1]
        if end_dt > start_dt:
            updated["end_time"] = _to_datetime_text(end_dt)
        else:
            updated.pop("end_time", None)
    updated["needs_clarification"] = False
    updated["clarification_question"] = ""
    if not updated.get("event_details"):
        extracted = _extract_event_title(user_text)
        if extracted:
            updated["event_details"] = extracted
    return updated


def _merge_reschedule_followup(prior_intent: dict, user_text: str, now: datetime) -> dict | None:
    base_date = _parse_date_from_text(user_text, now)
    candidates = [value for _, value in _collect_datetime_candidates(user_text, base_date)]
    if not candidates:
        return None

    updated = {**prior_intent}
    updated["action"] = "reschedule"

    duration_minutes = _extract_duration_minutes(user_text)

    missing_new = not updated.get("start_time")
    missing_old = not updated.get("existing_start_time")

    if missing_old and missing_new:
        if len(candidates) >= 2:
            updated["existing_start_time"] = _to_datetime_text(candidates[0])
            updated["existing_end_time"] = _to_datetime_text(candidates[0] + timedelta(minutes=duration_minutes))
            updated["start_time"] = _to_datetime_text(candidates[1])
            updated["end_time"] = _to_datetime_text(candidates[1] + timedelta(minutes=duration_minutes))
            updated["needs_clarification"] = False
        else:
            updated["existing_start_time"] = _to_datetime_text(candidates[0])
            updated["existing_end_time"] = _to_datetime_text(candidates[0] + timedelta(minutes=duration_minutes))
            updated["needs_clarification"] = True
            updated["clarification_question"] = "And what is the new date and time you want to move it to?"
    elif missing_old and not missing_new:
        updated["existing_start_time"] = _to_datetime_text(candidates[0])
        updated["existing_end_time"] = _to_datetime_text(candidates[0] + timedelta(minutes=duration_minutes))
        updated["needs_clarification"] = False
        updated["clarification_question"] = ""
    elif missing_new and not missing_old:
        updated["start_time"] = _to_datetime_text(candidates[0])
        updated["end_time"] = _to_datetime_text(candidates[0] + timedelta(minutes=duration_minutes))
        updated["needs_clarification"] = False
        updated["clarification_question"] = ""

    return updated


def _regex_parse_intent(user_text: str, now: datetime) -> dict | None:
    lowered = user_text.lower()
    base_date = _parse_date_from_text(user_text, now)
    if any(word in lowered for word in ["cancel", "cancellation", "remove", "delete"]):
        candidates = [value for _, value in _collect_datetime_candidates(user_text, base_date)]
        start_dt = candidates[0] if candidates else None
        end_dt = candidates[1] if len(candidates) > 1 else None
        start = _to_datetime_text(start_dt) if start_dt else None
        end = _to_datetime_text(end_dt) if (start_dt and end_dt and end_dt > start_dt) else None
        extracted_title = _extract_event_title(user_text)
        return {
            "action": "cancel",
            "start_time": start,
            "end_time": end,
            "existing_start_time": None,
            "existing_end_time": None,
            "event_details": extracted_title or "Booking via AI assistant",
            "needs_clarification": start is None,
            "clarification_question": "Sure - which meeting should I cancel? Please share its start time.",
        }
    if "resched" in lowered or "reschedule" in lowered or "move" in lowered:
        duration_minutes = _extract_duration_minutes(user_text)
        candidates = [value for _, value in _collect_datetime_candidates(user_text, base_date)]
        details = _extract_booking_title(user_text) or "Booking via AI assistant"
        if len(candidates) >= 2:
            current_start = candidates[0]
            new_start = candidates[1]
            return {
                "action": "reschedule",
                "start_time": _to_datetime_text(new_start),
                "end_time": _to_datetime_text(new_start + timedelta(minutes=duration_minutes)),
                "existing_start_time": _to_datetime_text(current_start),
                "existing_end_time": _to_datetime_text(current_start + timedelta(minutes=duration_minutes)),
                "event_details": details,
                "needs_clarification": False,
                "clarification_question": "",
            }

        if len(candidates) == 1:
            target = candidates[0]
            if "to" in lowered.split() or "for" in lowered.split():
                return {
                    "action": "reschedule",
                    "start_time": _to_datetime_text(target),
                    "end_time": _to_datetime_text(target + timedelta(minutes=duration_minutes)),
                    "existing_start_time": None,
                    "existing_end_time": None,
                    "event_details": details,
                    "needs_clarification": True,
                    "clarification_question": "I need the current meeting time before I can reschedule it."
                }
            else:
                return {
                    "action": "reschedule",
                    "start_time": None,
                    "end_time": None,
                    "existing_start_time": _to_datetime_text(target),
                    "existing_end_time": _to_datetime_text(target + timedelta(minutes=duration_minutes)),
                    "event_details": details,
                    "needs_clarification": True,
                    "clarification_question": "What is the new date and time you want to move it to?"
                }

        return {
            "action": "reschedule",
            "start_time": None,
            "end_time": None,
            "existing_start_time": None,
            "existing_end_time": None,
            "event_details": details,
            "needs_clarification": True,
            "clarification_question": "Sure — which meeting should I move, and what is the new date and time?",
        }
    action_keywords = ["book", "schedule", "set up", "meeting", "sync", "call"]
    if not any(keyword in lowered for keyword in action_keywords):
        return None

    range_match = re.search(
        r"from\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)\s+to\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)",
        lowered,
    )
    if range_match:
        start_dt = _parse_time_token(range_match.group(1), base_date)
        end_dt = _parse_time_token(range_match.group(2), base_date)
        if start_dt and end_dt and end_dt > start_dt:
            details_match = re.search(r"for\s+(.+)$", user_text, flags=re.IGNORECASE)
            details = _derive_event_details(
                user_text,
                details_match.group(1) if details_match else None,
            )
            return {
                "action": "book",
                "start_time": _to_datetime_text(start_dt),
                "end_time": _to_datetime_text(end_dt),
                "event_details": details,
                "needs_clarification": False,
                "clarification_question": "",
            }

    at_match = re.search(
        r"(?:at\s+)?([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm))",
        lowered,
    )
    if at_match:
        start_dt = _parse_time_token(at_match.group(1), base_date)
        if start_dt:
            duration = _extract_duration_minutes(user_text)
            end_dt = start_dt + timedelta(minutes=duration)
            details_match = re.search(r"for\s+(.+)$", user_text, flags=re.IGNORECASE)
            details = _derive_event_details(
                user_text,
                details_match.group(1) if details_match else None,
            )
            return {
                "action": "book",
                "start_time": _to_datetime_text(start_dt),
                "end_time": _to_datetime_text(end_dt),
                "event_details": details,
                "needs_clarification": False,
                "clarification_question": "",
            }

    return None


def _parse_conflict_selection(
    user_text: str,
    conflict_suggestions: list[str],
) -> tuple[str, str] | None:
    if not conflict_suggestions:
        return None

    lowered = user_text.lower().strip()
    idx: int | None = None

    option_match = re.search(r"\b(option\s*)?(\d+)\b", lowered)
    if option_match:
        idx = int(option_match.group(2)) - 1

    if idx is None:
        if "first" in lowered or "1st" in lowered:
            idx = 0
        elif "second" in lowered or "2nd" in lowered:
            idx = 1
        elif "third" in lowered or "3rd" in lowered:
            idx = 2
        elif lowered in {"yes", "ok", "okay", "sure", "book it", "confirm"}:
            idx = 0

    if idx is None:
        for i, suggestion in enumerate(conflict_suggestions):
            start_token = suggestion.split(" to ")[0]
            if start_token in user_text:
                idx = i
                break

    if idx is None:
        return None

    if idx < 0 or idx >= len(conflict_suggestions):
        return None

    selected = conflict_suggestions[idx]
    split_match = re.match(
        r"\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+to\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*",
        selected,
    )
    if not split_match:
        return None

    return split_match.group(1), split_match.group(2)


def _get_last_human_message(messages: list[BaseMessage]) -> str:
    for msg in reversed(messages):
        if isinstance(msg, HumanMessage):
            return msg.content if isinstance(msg.content, str) else str(msg.content)
    return ""


def _create_llm(
    model_name: str | None = None,
    provider: str | None = None,
) -> BaseChatModel:
    selected_provider = (provider or os.getenv("LLM_PROVIDER", "openai")).lower()

    if selected_provider == "ollama":
        try:
            from langchain_ollama import ChatOllama
        except ImportError as exc:
            raise RuntimeError(
                "Ollama provider selected but langchain-ollama is not installed."
            ) from exc

        selected_model = model_name or os.getenv("OLLAMA_MODEL", "llama3.1:8b")
        return ChatOllama(model=selected_model, temperature=0)

    selected_model = model_name or os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    return ChatOpenAI(model=selected_model, temperature=0)


def intent_parser_node(state: BookingAgentState, llm: BaseChatModel) -> dict:
    user_text = _get_last_human_message(state.get("messages", []))
    prior_intent = state.get("current_intent", {})

    if not user_text:
        return {
            "booking_status": "needs_clarification",
            "messages": [
                AIMessage(content="Please tell me what date and time you want to book.")
            ],
        }

    selected_option = _parse_conflict_selection(
        user_text,
        state.get("conflict_suggestions", []),
    )
    if selected_option:
        start_time, end_time = selected_option
        next_action = prior_intent.get("action", "book")
        return {
            "current_intent": {
                **prior_intent,
                "action": next_action,
                "start_time": start_time,
                "end_time": end_time,
                "needs_clarification": False,
            },
            "booking_status": "pending",
        }

    if _is_plain_greeting(user_text):
        return {
            "booking_status": "needs_clarification",
            "conflict_suggestions": [],
            "messages": [
                AIMessage(
                    content=(
                        "Hi there! I can book or reschedule meetings - what would you like to do?"
                    )
                )
            ],
        }

    now = datetime.now()

    if prior_intent.get("action") == "cancel" and prior_intent.get("needs_clarification"):
        merged = _merge_cancel_followup(prior_intent, user_text, now)
        if merged:
            return {
                "current_intent": merged,
                "booking_status": "pending",
                "conflict_suggestions": [],
            }

        return {
            "current_intent": prior_intent,
            "booking_status": "needs_clarification",
            "conflict_suggestions": [],
            "messages": [
                AIMessage(
                    content=(
                        "I need the start time of the meeting you want to cancel. "
                        "Please share it like 'cancel March 28 at 11:30 AM'."
                    )
                )
            ],
        }

    if prior_intent.get("action") == "reschedule" and prior_intent.get("needs_clarification"):
        merged = _merge_reschedule_followup(prior_intent, user_text, now)
        if merged:
            return {
                "current_intent": merged,
                "booking_status": "needs_clarification" if merged.get("needs_clarification") else "pending",
                "conflict_suggestions": [],
                "messages": [AIMessage(content=merged["clarification_question"])] if merged.get("needs_clarification") else [],
            }
        return {
            "current_intent": prior_intent,
            "booking_status": "needs_clarification",
            "conflict_suggestions": [],
            "messages": [
                AIMessage(
                    content=(
                        "I need both the current meeting time and the new preferred time. "
                        "Please share it."
                    )
                )
            ],
        }

    regex_intent = _regex_parse_intent(user_text, now)
    if regex_intent:
        return {
            "current_intent": _enrich_event_details(regex_intent, user_text),
            "booking_status": "pending",
        }

    parser = llm.with_structured_output(ParsedIntent)
    now_text = now.strftime("%Y-%m-%d %H:%M:%S")

    parsed = parser.invoke(
        [
            SystemMessage(
                content=(
                    "You are an intent parser for a booking agent. "
                    "Extract schedule intent and normalize all times using this format: "
                    "YYYY-MM-DD HH:MM:SS. "
                    f"Current local datetime: {now_text}. "
                    "If the request is vague, set needs_clarification=true and ask one concise, specific follow-up question. "
                    "When a user gives start time but no end, default to a 30-minute meeting. "
                    "If the user wants to move an existing meeting, set action='reschedule' and capture both existing_start_time/existing_end_time (current slot) and start_time/end_time (new slot)."
                    "If the user wants to cancel a meeting, set action='cancel' and capture the meeting's start_time/end_time. If any of those are missing, ask for the specific detail."
                )
            ),
            HumanMessage(content=user_text),
        ]
    )

    parsed_dict = _enrich_event_details(parsed.model_dump(), user_text)

    if parsed.action == "book":
        if parsed.start_time and not parsed.end_time:
            start_dt = datetime.strptime(parsed.start_time, "%Y-%m-%d %H:%M:%S")
            parsed.end_time = _to_datetime_text(start_dt + timedelta(minutes=30))
            parsed.needs_clarification = False
            parsed_dict = parsed.model_dump()

        if parsed.needs_clarification or not parsed.start_time or not parsed.end_time:
            return {
                "current_intent": parsed_dict,
                "booking_status": "needs_clarification",
                "conflict_suggestions": [],
                "messages": [
                    AIMessage(
                        content=(
                            parsed.clarification_question
                            or "Please share date and time in one line, e.g. 'tomorrow 3 PM for 30 min'."
                        )
                    )
                ],
            }

        return {
            "current_intent": parsed_dict,
            "booking_status": "pending",
            "conflict_suggestions": [],
        }

    if parsed.action == "reschedule":
        missing_new_window = not (parsed.start_time and parsed.end_time)
        missing_existing = not (parsed.existing_start_time and parsed.existing_end_time)
        if parsed.needs_clarification or missing_new_window or missing_existing:
            question = parsed.clarification_question or (
                "To reschedule, please share the current meeting time and the new preferred time."
            )
            return {
                "current_intent": parsed_dict,
                "booking_status": "needs_clarification",
                "conflict_suggestions": [],
                "messages": [AIMessage(content=question)],
            }

        return {
            "current_intent": parsed_dict,
            "booking_status": "pending",
            "conflict_suggestions": [],
        }

    if parsed.action == "cancel":
        if not parsed.start_time:
            question = parsed.clarification_question or (
                "Which meeting should I cancel? Please share its start date and time."
            )
            return {
                "current_intent": parsed_dict,
                "booking_status": "needs_clarification",
                "conflict_suggestions": [],
                "messages": [AIMessage(content=question)],
            }

        return {
            "current_intent": parsed_dict,
            "booking_status": "pending",
            "conflict_suggestions": [],
        }

    return {
        "current_intent": parsed_dict,
        "booking_status": "needs_clarification",
        "conflict_suggestions": [],
        "messages": [
            AIMessage(
                content=(
                    parsed.clarification_question
                    or "Please share date and time in one line, e.g. 'tomorrow 3 PM for 30 min'."
                )
            )
        ],
    }


def availability_node(state: BookingAgentState) -> dict:
    if state.get("booking_status") == "needs_clarification":
        return {}

    intent = state.get("current_intent", {})
    action = intent.get("action", "book")
    start_time = intent.get("start_time")
    end_time = intent.get("end_time")
    existing_start = intent.get("existing_start_time")
    existing_end = intent.get("existing_end_time")

    if action == "cancel":
        if not start_time:
            return {
                "booking_status": "needs_clarification",
                "messages": [
                    AIMessage(
                        content="I need the meeting's start time before I can cancel it."
                    )
                ],
            }
        return {"booking_status": "pending"}

    if action == "reschedule" and (not existing_start or not existing_end):
        return {
            "booking_status": "needs_clarification",
            "messages": [
                AIMessage(
                    content="I need the current meeting time before I can reschedule it."
                )
            ],
        }

    if not start_time or not end_time:
        return {
            "booking_status": "needs_clarification",
            "messages": [
                AIMessage(
                    content="I need both start and end times to check availability."
                )
            ],
        }

    availability = check_availability(start_time, end_time)
    if availability["available"]:
        return {"booking_status": "pending"}

    start_dt = datetime.strptime(start_time, "%Y-%m-%d %H:%M:%S")
    end_dt = datetime.strptime(end_time, "%Y-%m-%d %H:%M:%S")
    duration = int((end_dt - start_dt).total_seconds() // 60)
    suggestions = find_next_available_slots(start_time, duration, max_suggestions=3)

    formatted_suggestions = [
        f"{item['start']} to {item['end']}" for item in suggestions
    ]

    return {
        "booking_status": "conflict",
        "conflict_suggestions": formatted_suggestions,
    }


def conflict_resolver_node(state: BookingAgentState, llm: BaseChatModel) -> dict:
    intent = state.get("current_intent", {})
    action = intent.get("action", "book")
    requested_window = (
        f"{intent.get('start_time', 'unknown')} to {intent.get('end_time', 'unknown')}"
    )
    suggestions = state.get("conflict_suggestions", [])

    if suggestions:
        option_lines = "\n".join(
            f"{idx}. {slot}" for idx, slot in enumerate(suggestions, start=1)
        )
        intro = (
            f"That time is already booked: {requested_window}."
            if action == "book"
            else f"I can't move the meeting to {requested_window} because it's taken."
        )
        message = (
            f"{intro}\n\n"
            "Here are the next available options:\n\n"
            f"{option_lines}\n\n"
            "Reply with 'option 1', 'option 2', or paste a preferred time window."
        )
    else:
        intro = (
            f"That time is already booked: {requested_window}."
            if action == "book"
            else f"I could not reschedule to {requested_window}."
        )
        message = (
            f"{intro}\n"
            "I could not find nearby alternatives. Please share another preferred date/time."
        )

    return {"messages": [AIMessage(content=message)]}


def booking_confirmer_node(state: BookingAgentState) -> dict:
    intent = state.get("current_intent", {})
    start_time = intent.get("start_time")
    end_time = intent.get("end_time")
    details = intent.get("event_details", "Booking via AI assistant")

    if not start_time or not end_time:
        return {
            "booking_status": "needs_clarification",
            "messages": [
                AIMessage(content="I could not confirm because the time window is incomplete.")
            ],
        }

    result = book_meeting(start_time, end_time, details)

    if not result["success"]:
        return {
            "booking_status": "conflict",
            "messages": [AIMessage(content=result["message"])],
        }

    summary = result["summary"]
    confirmation_text = (
        "Booking confirmed.\n"
        f"- Start: {summary['start_time']}\n"
        f"- End: {summary['end_time']}\n"
        f"- Details: {summary['details']}\n"
        f"- Slots reserved: {summary['booked_slots']}"
    )

    return {
        "booking_status": "confirmed",
        "messages": [AIMessage(content=confirmation_text)],
    }


def reschedule_executor_node(state: BookingAgentState) -> dict:
    intent = state.get("current_intent", {})
    new_start = intent.get("start_time")
    new_end = intent.get("end_time")
    existing_start = intent.get("existing_start_time")
    existing_end = intent.get("existing_end_time")
    
    details = intent.get("event_details")
    if not details or _is_placeholder_detail(details):
        window = get_booked_window(existing_start) if existing_start else None
        if window:
            details = window["details"]
        else:
            details = "Booking via AI assistant"

    if not all([new_start, new_end, existing_start, existing_end]):
        return {
            "booking_status": "needs_clarification",
            "messages": [
                AIMessage(
                    content="To reschedule, I need both the current meeting time and the new preferred time."
                )
            ],
        }

    result = reschedule_meeting(existing_start, existing_end, new_start, new_end, details)

    if not result["success"]:
        return {
            "booking_status": "conflict",
            "messages": [AIMessage(content=result["message"])],
        }

    summary = result.get("summary", {})
    confirmation_text = (
        "Meeting rescheduled.\n"
        f"- Previous: {summary.get('previous_start', existing_start)} to {summary.get('previous_end', existing_end)}\n"
        f"- New: {summary.get('new_start', new_start)} to {summary.get('new_end', new_end)}\n"
        f"- Details: {summary.get('details', details)}"
    )

    return {
        "booking_status": "rescheduled",
        "messages": [AIMessage(content=confirmation_text)],
    }


def cancel_executor_node(state: BookingAgentState) -> dict:
    intent = state.get("current_intent", {})
    target_start = intent.get("start_time") or intent.get("existing_start_time")
    target_end = intent.get("end_time") or intent.get("existing_end_time")

    if not target_start:
        return {
            "booking_status": "needs_clarification",
            "messages": [
                AIMessage(
                    content="I still need the meeting start time before I can cancel it."
                )
            ],
        }

    details = intent.get("event_details", "Booking via AI assistant")
    start_dt = _from_datetime_text(target_start)
    if target_end:
        end_dt = _from_datetime_text(target_end)
        if (not end_dt) or (start_dt and end_dt <= start_dt):
            target_end = None
    resolved_end = target_end

    candidate_windows: list[dict[str, str]] = []

    if not resolved_end:
        window = get_booked_window(target_start)
        if window:
            resolved_end = window["end"]
            details = window["details"]
        else:
            candidate_windows = find_matching_bookings(details, target_start)
            if not candidate_windows and details:
                candidate_windows = find_matching_bookings(details, None)
            if not candidate_windows:
                candidate_windows = find_matching_bookings(None, target_start)

            if candidate_windows:
                if len(candidate_windows) == 1:
                    target_start = candidate_windows[0]["start_text"]
                    resolved_end = candidate_windows[0]["end_text"]
                    details = candidate_windows[0]["details"]
                else:
                    formatted = [
                        f"{item['start_text']} to {item['end_text']} ({item['details']})"
                        for item in candidate_windows
                    ]
                    suggestions = [
                        f"{item['start_text']} to {item['end_text']}"
                        for item in candidate_windows
                    ]
                    message = (
                        "I found multiple bookings that match that description:\n"
                        + "\n".join(f"{idx}. {entry}" for idx, entry in enumerate(formatted, start=1))
                        + "\n\nReply with the option number or paste the exact start time you want to cancel."
                    )
                    return {
                        "booking_status": "needs_clarification",
                        "messages": [AIMessage(content=message)],
                        "conflict_suggestions": suggestions,
                        "current_intent": {**intent, "action": "cancel"},
                    }

    if not resolved_end:
        return {
            "booking_status": "needs_clarification",
            "messages": [
                AIMessage(
                    content=(
                        "I could not find a booking starting at that time. "
                        "Please provide the full start and end time."
                    )
                )
            ],
        }

    result = cancel_meeting(target_start, resolved_end)

    if not result["success"]:
        return {
            "booking_status": "needs_clarification",
            "messages": [AIMessage(content=result["message"])],
        }

    confirmation_text = (
        "Booking cancelled.\n"
        f"- Start: {target_start}\n"
        f"- End: {resolved_end}\n"
        f"- Details: {details}"
    )

    return {
        "booking_status": "cancelled",
        "messages": [AIMessage(content=confirmation_text)],
        "current_intent": {
            **intent,
            "action": "cancel",
            "start_time": target_start,
            "end_time": resolved_end,
            "event_details": details,
        },
    }


def route_after_availability(state: BookingAgentState) -> str:
    status = state.get("booking_status")
    action = state.get("current_intent", {}).get("action", "book")
    if status == "pending":
        if action == "reschedule":
            return "reschedule_executor"
        if action == "cancel":
            return "cancel_executor"
        return "booking_confirmer"
    if status == "conflict":
        return "conflict_resolver"
    return END


def create_booking_graph(
    model_name: str | None = None,
    provider: str | None = None,
):
    llm = _create_llm(model_name=model_name, provider=provider)

    workflow = StateGraph(BookingAgentState)
    workflow.add_node("intent_parser", lambda state: intent_parser_node(state, llm))
    workflow.add_node("availability", availability_node)
    workflow.add_node(
        "conflict_resolver", lambda state: conflict_resolver_node(state, llm)
    )
    workflow.add_node("booking_confirmer", booking_confirmer_node)
    workflow.add_node("reschedule_executor", reschedule_executor_node)
    workflow.add_node("cancel_executor", cancel_executor_node)

    workflow.add_edge(START, "intent_parser")
    workflow.add_edge("intent_parser", "availability")

    # Conditional routing based on availability outcome:
    # - pending  -> booking_confirmer
    # - conflict -> conflict_resolver
    # - others   -> END
    workflow.add_conditional_edges(
        "availability",
        route_after_availability,
        {
            "booking_confirmer": "booking_confirmer",
            "conflict_resolver": "conflict_resolver",
            "reschedule_executor": "reschedule_executor",
            "cancel_executor": "cancel_executor",
            END: END,
        },
    )

    workflow.add_edge("booking_confirmer", END)
    workflow.add_edge("reschedule_executor", END)
    workflow.add_edge("cancel_executor", END)
    workflow.add_edge("conflict_resolver", END)

    checkpointer = MemorySaver()
    return workflow.compile(checkpointer=checkpointer)
