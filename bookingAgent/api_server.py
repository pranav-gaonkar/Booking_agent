"""FastAPI bridge for the LangGraph booking agent used by the React frontend."""

from __future__ import annotations

import csv
import io
import os
import re
import shutil
import threading
import tempfile
import uuid
from datetime import datetime, timedelta
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from langchain_core.messages import AIMessage, HumanMessage
from pydantic import BaseModel, Field

from database import DATETIME_FMT, SLOT_MINUTES, get_connection
from database import init_db
from graph import create_booking_graph


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    thread_id: str | None = None


class ChatResponse(BaseModel):
    reply: str
    thread_id: str
    booking_status: str
    conflict_suggestions: list[str]
    state: dict[str, Any]


class BookingItem(BaseModel):
    id: str
    title: str
    date: str
    time: str
    duration: str
    participants: list[str]
    status: str


class StatsResponse(BaseModel):
    total_bookings: int
    confirmed: int
    pending: int
    conflicts: int


class SummaryResponse(BaseModel):
    stats: StatsResponse
    bookings: list[BookingItem]


class NotificationItem(BaseModel):
    id: str
    type: str
    title: str
    message: str
    time: str
    read: bool


class NotificationListResponse(BaseModel):
    notifications: list[NotificationItem]
    unread_count: int


class MarkAllReadResponse(BaseModel):
    unread_count: int


class DismissResponse(BaseModel):
    ok: bool
    unread_count: int


class ImportCsvRequest(BaseModel):
    csv_content: str = Field(min_length=1)


class ImportCsvResponse(BaseModel):
    imported: int
    skipped: int
    errors: list[str]


class TranscriptionResponse(BaseModel):
    text: str


app = FastAPI(title="Booking Agent API", version="1.0.0")

allowed_origins = os.getenv(
    "AGENT_ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
)
allowed_origin_regex = os.getenv(
    "AGENT_ALLOWED_ORIGIN_REGEX",
    r"^https?://(localhost|127\.0\.0\.1|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in allowed_origins.split(",") if origin.strip()],
    allow_origin_regex=allowed_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()
_provider = os.getenv("LLM_PROVIDER", "ollama").lower()
_model_name = (
    os.getenv("OLLAMA_MODEL", "llama3.1:8b")
    if _provider == "ollama"
    else os.getenv("OPENAI_MODEL", "gpt-4o-mini")
)
AGENT_GRAPH = create_booking_graph(provider=_provider, model_name=_model_name)
WHISPER_MODEL_NAME = os.getenv("WHISPER_MODEL", "base")
_WHISPER_MODEL = None


_notifications_lock = threading.Lock()
STATUS_EVENT_WINDOW_HOURS = int(os.getenv("AGENT_STATUS_EVENT_WINDOW_HOURS", "24"))
_notifications: list[dict[str, Any]] = [
    {
        "id": "1",
        "type": "success",
        "title": "Booking Agent Ready",
        "message": "The booking backend is connected and ready.",
        "time": "just now",
        "created_at": datetime.utcnow().isoformat(),
        "read": False,
    },
    {
        "id": "2",
        "type": "info",
        "title": "Tip",
        "message": "Try: Book a meeting tomorrow from 10:00 to 10:30.",
        "time": "just now",
        "created_at": datetime.utcnow().isoformat(),
        "read": False,
    },
]


def _fmt_date(value: datetime) -> str:
    return value.strftime("%Y-%m-%d")


def _fmt_time(value: datetime) -> str:
    return value.strftime("%I:%M %p")


def _fmt_duration_minutes(minutes: int) -> str:
    if minutes < 60:
        return f"{minutes} min"
    hours = minutes / 60
    if hours.is_integer():
        return f"{int(hours)} hr"
    return f"{hours:.1f} hrs"


def _fetch_bookings() -> list[BookingItem]:
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

    grouped: list[dict[str, Any]] = []
    for row in rows:
        start = datetime.strptime(row["start_datetime"], DATETIME_FMT)
        end = datetime.strptime(row["end_datetime"], DATETIME_FMT)
        details = row["event_details"] or "Booking via AI assistant"

        if not grouped:
            grouped.append({"start": start, "end": end, "details": details})
            continue

        last = grouped[-1]
        if last["details"] == details and last["end"] == start:
            last["end"] = end
        else:
            grouped.append({"start": start, "end": end, "details": details})

    bookings: list[BookingItem] = []
    for idx, booking in enumerate(grouped, start=1):
        duration_minutes = int((booking["end"] - booking["start"]).total_seconds() // 60)
        bookings.append(
            BookingItem(
                id=str(idx),
                title=str(booking["details"]),
                date=_fmt_date(booking["start"]),
                time=_fmt_time(booking["start"]),
                duration=_fmt_duration_minutes(duration_minutes),
                participants=["AI Scheduled"],
                status="confirmed",
            )
        )

    return bookings


def _build_stats(
    bookings: list[BookingItem],
    *,
    pending_events: int = 0,
    conflict_events: int = 0,
) -> StatsResponse:
    confirmed = len([b for b in bookings if b.status == "confirmed"])
    pending = len([b for b in bookings if b.status == "pending"]) + pending_events
    conflicts = len([b for b in bookings if b.status == "conflict"]) + conflict_events
    return StatsResponse(
        total_bookings=len(bookings),
        confirmed=confirmed,
        pending=pending,
        conflicts=conflicts,
    )


def _count_status_notifications() -> tuple[int, int]:
    cutoff = datetime.utcnow() - timedelta(hours=STATUS_EVENT_WINDOW_HOURS)

    def is_recent(item: dict[str, Any]) -> bool:
        created_at = item.get("created_at")
        if not created_at:
            return False
        try:
            return datetime.fromisoformat(str(created_at)) >= cutoff
        except ValueError:
            return False

    with _notifications_lock:
        pending = len(
            [
                n
                for n in _notifications
                if n.get("type") == "info"
                and n.get("title") == "Needs Clarification"
                and is_recent(n)
            ]
        )
        conflicts = len(
            [
                n
                for n in _notifications
                if n.get("type") == "warning"
                and n.get("title") == "Scheduling Conflict"
                and is_recent(n)
            ]
        )
    return pending, conflicts


def _unread_count(items: list[dict[str, Any]]) -> int:
    return len([item for item in items if not item.get("read", False)])


def _push_notification(kind: str, title: str, message: str) -> None:
    with _notifications_lock:
        next_id = str(max([int(item["id"]) for item in _notifications], default=0) + 1)
        _notifications.insert(
            0,
            {
                "id": next_id,
                "type": kind,
                "title": title,
                "message": message,
                "time": "just now",
                "created_at": datetime.utcnow().isoformat(),
                "read": False,
            },
        )


def _parse_duration_minutes(text: str) -> int:
    lowered = text.strip().lower()
    min_match = re.search(r"(\d{1,3})\s*(min|mins|minute|minutes)", lowered)
    if min_match:
        return int(min_match.group(1))

    hr_match = re.search(r"(\d{1,2})(?:\.(\d))?\s*(h|hr|hrs|hour|hours)", lowered)
    if hr_match:
        whole = int(hr_match.group(1))
        decimal = hr_match.group(2)
        if decimal:
            return max(SLOT_MINUTES, int(float(f"{whole}.{decimal}") * 60))
        return max(SLOT_MINUTES, whole * 60)

    if lowered.isdigit():
        return max(SLOT_MINUTES, int(lowered))

    return SLOT_MINUTES


def _parse_start_datetime(date_text: str, time_text: str) -> datetime:
    date_text = date_text.strip()
    time_text = time_text.strip().upper()

    date_formats = ["%Y-%m-%d", "%d-%m-%Y", "%m/%d/%Y", "%d/%m/%Y"]
    time_formats = ["%H:%M", "%I:%M %p", "%I %p"]

    parsed_date = None
    for fmt in date_formats:
        try:
            parsed_date = datetime.strptime(date_text, fmt).date()
            break
        except ValueError:
            continue
    if parsed_date is None:
        raise ValueError(f"Unsupported date format: {date_text}")

    parsed_time = None
    for fmt in time_formats:
        try:
            parsed_time = datetime.strptime(time_text, fmt).time()
            break
        except ValueError:
            continue
    if parsed_time is None:
        raise ValueError(f"Unsupported time format: {time_text}")

    return datetime.combine(parsed_date, parsed_time)


def _get_whisper_model():
    global _WHISPER_MODEL
    if _WHISPER_MODEL is not None:
        return _WHISPER_MODEL

    try:
        import whisper  # type: ignore
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=503,
            detail=(
                "Server transcription is not available. Install dependencies with "
                "'pip install -r requirements-booking-agent.txt'."
            ),
        ) from exc

    try:
        _WHISPER_MODEL = whisper.load_model(WHISPER_MODEL_NAME)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Failed to load Whisper model: {exc}") from exc

    return _WHISPER_MODEL


def _ensure_ffmpeg_available() -> None:
    ffmpeg_in_path = shutil.which("ffmpeg")
    if ffmpeg_in_path:
        return

    try:
        import imageio_ffmpeg  # type: ignore
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=503,
            detail=(
                "FFmpeg is required for transcription but is not installed. "
                "Install dependencies with 'pip install -r requirements-booking-agent.txt'."
            ),
        ) from exc

    source_ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    ffmpeg_dir = os.path.join(tempfile.gettempdir(), "booking-agent-ffmpeg")
    os.makedirs(ffmpeg_dir, exist_ok=True)
    target_ffmpeg = os.path.join(ffmpeg_dir, "ffmpeg.exe")

    if not os.path.exists(target_ffmpeg):
        shutil.copyfile(source_ffmpeg, target_ffmpeg)

    os.environ["PATH"] = f"{ffmpeg_dir}{os.pathsep}{os.environ.get('PATH', '')}"


def _upsert_booked_window(start_dt: datetime, end_dt: datetime, details: str) -> None:
    with get_connection() as conn:
        cursor = start_dt
        while cursor < end_dt:
            slot_end = cursor + timedelta(minutes=SLOT_MINUTES)
            start_text = cursor.strftime(DATETIME_FMT)
            end_text = slot_end.strftime(DATETIME_FMT)

            existing = conn.execute(
                """
                SELECT id
                FROM calendar
                WHERE start_datetime = ? AND end_datetime = ?
                """,
                (start_text, end_text),
            ).fetchone()

            if existing:
                conn.execute(
                    """
                    UPDATE calendar
                    SET status = 'booked', event_details = ?
                    WHERE id = ?
                    """,
                    (details, existing["id"]),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO calendar (start_datetime, end_datetime, status, event_details)
                    VALUES (?, ?, 'booked', ?)
                    """,
                    (start_text, end_text, details),
                )

            cursor = slot_end

        conn.commit()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/chat", response_model=ChatResponse)
def chat(payload: ChatRequest) -> ChatResponse:
    thread_id = payload.thread_id or str(uuid.uuid4())

    try:
        result_state = AGENT_GRAPH.invoke(
            {
                "messages": [HumanMessage(content=payload.message)],
            },
            config={"configurable": {"thread_id": thread_id}},
        )
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Agent execution failed: {exc}") from exc

    reply = "I could not generate a response."
    for message in reversed(result_state.get("messages", [])):
        if isinstance(message, AIMessage):
            reply = message.content if isinstance(message.content, str) else str(message.content)
            break

    booking_status = str(result_state.get("booking_status", "pending"))
    conflict_suggestions = [str(x) for x in result_state.get("conflict_suggestions", [])]
    current_intent = result_state.get("current_intent", {})

    if booking_status == "confirmed":
        start_time = str(current_intent.get("start_time", "scheduled slot"))
        _push_notification(
            "success",
            "Meeting Confirmed",
            f"Booking confirmed for {start_time}.",
        )
    elif booking_status == "rescheduled":
        start_time = str(current_intent.get("start_time", "new slot"))
        existing_time = str(current_intent.get("existing_start_time", "previous slot"))
        _push_notification(
            "success",
            "Meeting Rescheduled",
            f"Moved meeting from {existing_time} to {start_time}.",
        )
    elif booking_status == "cancelled":
        start_time = str(current_intent.get("start_time", "released slot"))
        _push_notification(
            "info",
            "Booking Cancelled",
            f"Freed the slot that started at {start_time}.",
        )
    elif booking_status == "conflict":
        _push_notification(
            "warning",
            "Scheduling Conflict",
            "Requested slot is unavailable. Alternatives are available.",
        )
    elif booking_status == "needs_clarification":
        _push_notification(
            "info",
            "Needs Clarification",
            "Additional date/time details are needed to complete this request.",
        )

    return ChatResponse(
        reply=reply,
        thread_id=thread_id,
        booking_status=booking_status,
        conflict_suggestions=conflict_suggestions,
        state={"current_intent": current_intent},
    )


@app.post("/api/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(audio: UploadFile = File(...)) -> TranscriptionResponse:
    content = await audio.read()
    if not content:
        raise HTTPException(status_code=400, detail="No audio payload provided")

    _ensure_ffmpeg_available()
    model = _get_whisper_model()

    suffix = os.path.splitext(audio.filename or "voice.webm")[1] or ".webm"
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(content)
            temp_path = tmp.name

        result = model.transcribe(temp_path, fp16=False)
        text = str(result.get("text", "")).strip()
        if not text:
            raise HTTPException(status_code=422, detail="Speech could not be transcribed")
        return TranscriptionResponse(text=text)
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}") from exc
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


@app.get("/api/bookings", response_model=list[BookingItem])
def get_bookings() -> list[BookingItem]:
    return _fetch_bookings()


@app.get("/api/stats", response_model=StatsResponse)
def get_stats() -> StatsResponse:
    bookings = _fetch_bookings()
    pending_events, conflict_events = _count_status_notifications()
    return _build_stats(bookings, pending_events=pending_events, conflict_events=conflict_events)


@app.get("/api/summary", response_model=SummaryResponse)
def get_summary() -> SummaryResponse:
    bookings = _fetch_bookings()
    pending_events, conflict_events = _count_status_notifications()
    return SummaryResponse(
        stats=_build_stats(bookings, pending_events=pending_events, conflict_events=conflict_events),
        bookings=bookings,
    )


@app.get("/api/notifications", response_model=NotificationListResponse)
def get_notifications() -> NotificationListResponse:
    with _notifications_lock:
        items = [NotificationItem(**n) for n in _notifications]
        unread = _unread_count(_notifications)
    return NotificationListResponse(notifications=items, unread_count=unread)


@app.post("/api/notifications/mark-all-read", response_model=MarkAllReadResponse)
def mark_notifications_read() -> MarkAllReadResponse:
    with _notifications_lock:
        for item in _notifications:
            item["read"] = True
        unread = _unread_count(_notifications)
    return MarkAllReadResponse(unread_count=unread)


@app.delete("/api/notifications/{notification_id}", response_model=DismissResponse)
def dismiss_notification(notification_id: str) -> DismissResponse:
    with _notifications_lock:
        idx = next(
            (i for i, item in enumerate(_notifications) if item["id"] == notification_id),
            None,
        )
        if idx is None:
            raise HTTPException(status_code=404, detail="Notification not found")
        _notifications.pop(idx)
        unread = _unread_count(_notifications)
    return DismissResponse(ok=True, unread_count=unread)


@app.post("/api/bookings/import-csv", response_model=ImportCsvResponse)
def import_bookings_csv(payload: ImportCsvRequest) -> ImportCsvResponse:
    reader = csv.DictReader(io.StringIO(payload.csv_content))
    required = {"title", "date", "time", "duration"}
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV must include a header row")

    header_fields = {name.strip().lower() for name in reader.fieldnames}
    if not required.issubset(header_fields):
        raise HTTPException(
            status_code=400,
            detail="CSV headers must include: title,date,time,duration",
        )

    imported = 0
    skipped = 0
    errors: list[str] = []

    for idx, row in enumerate(reader, start=2):
        if not row:
            skipped += 1
            continue

        normalized = {str(k).strip().lower(): (v or "").strip() for k, v in row.items()}
        status = normalized.get("status", "confirmed").lower()
        if status and status not in {"confirmed", "booked", "pending", "conflict"}:
            skipped += 1
            errors.append(f"Line {idx}: unsupported status '{status}'")
            continue

        if status in {"pending", "conflict"}:
            skipped += 1
            continue

        title = normalized.get("title", "")
        date_text = normalized.get("date", "")
        time_text = normalized.get("time", "")
        duration_text = normalized.get("duration", "")

        if not title or not date_text or not time_text or not duration_text:
            skipped += 1
            errors.append(f"Line {idx}: missing required field values")
            continue

        try:
            start_dt = _parse_start_datetime(date_text, time_text)
            duration_minutes = _parse_duration_minutes(duration_text)
            end_dt = start_dt + timedelta(minutes=duration_minutes)
            _upsert_booked_window(start_dt, end_dt, title)
            imported += 1
        except Exception as exc:  # pragma: no cover
            skipped += 1
            errors.append(f"Line {idx}: {exc}")

    if imported > 0:
        _push_notification(
            "success",
            "CSV Imported",
            f"Imported {imported} booking(s) from CSV.",
        )

    return ImportCsvResponse(imported=imported, skipped=skipped, errors=errors[:10])
