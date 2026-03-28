"""SQLite setup and seeding utilities for the booking agent."""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterator

DB_PATH = os.getenv(
    "BOOKING_AGENT_DB_PATH",
    str(Path(__file__).resolve().parent / "booking_agent.db"),
)
DATETIME_FMT = "%Y-%m-%d %H:%M:%S"
SLOT_MINUTES = 30


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def _to_str(dt: datetime) -> str:
    return dt.strftime(DATETIME_FMT)


def _seed_calendar(conn: sqlite3.Connection, days_ahead: int = 5) -> None:
    now = datetime.now().replace(minute=0, second=0, microsecond=0)
    slots: list[tuple[str, str, str, str | None]] = []

    for day_offset in range(days_ahead):
        day_start = (now + timedelta(days=day_offset)).replace(hour=9)
        day_end = day_start.replace(hour=18)
        current = day_start
        while current < day_end:
            slot_end = current + timedelta(minutes=SLOT_MINUTES)
            slots.append((_to_str(current), _to_str(slot_end), "free", None))
            current = slot_end

    conn.executemany(
        """
        INSERT INTO calendar (start_datetime, end_datetime, status, event_details)
        VALUES (?, ?, ?, ?)
        """,
        slots,
    )

    # Mark a few deterministic slots as booked for conflict testing.
    bookings = [
        {
            "start": now.replace(hour=10, minute=0),
            "end": now.replace(hour=11, minute=0),
            "details": "Daily stand-up",
        },
        {
            "start": (now + timedelta(days=1)).replace(hour=14, minute=0),
            "end": (now + timedelta(days=1)).replace(hour=15, minute=0),
            "details": "Product sync",
        },
        {
            "start": (now + timedelta(days=2)).replace(hour=16, minute=0),
            "end": (now + timedelta(days=2)).replace(hour=16, minute=30),
            "details": "1:1 coaching",
        },
    ]

    for booking in bookings:
        conn.execute(
            """
            UPDATE calendar
            SET status = 'booked', event_details = ?
            WHERE start_datetime >= ?
              AND end_datetime <= ?
            """,
            (
                booking["details"],
                _to_str(booking["start"]),
                _to_str(booking["end"]),
            ),
        )


def _seed_user_preferences(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        INSERT OR REPLACE INTO user_preferences (user_id, preferred_hours, timezone)
        VALUES (?, ?, ?)
        """,
        ("default_user", "09:00-17:00", "UTC"),
    )


def init_db(force_reset: bool = False) -> None:
    os.makedirs(Path(DB_PATH).resolve().parent, exist_ok=True)

    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS calendar (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                start_datetime TEXT NOT NULL,
                end_datetime TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('free', 'booked')),
                event_details TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_preferences (
                user_id TEXT PRIMARY KEY,
                preferred_hours TEXT NOT NULL,
                timezone TEXT NOT NULL
            )
            """
        )

        if force_reset:
            conn.execute("DELETE FROM calendar")
            conn.execute("DELETE FROM user_preferences")

        row = conn.execute("SELECT COUNT(*) AS count FROM calendar").fetchone()
        is_empty = bool(row and row["count"] == 0)

        if is_empty:
            _seed_calendar(conn)
            _seed_user_preferences(conn)

        conn.commit()


if __name__ == "__main__":
    init_db(force_reset=True)
    print(f"Database initialized at: {DB_PATH}")
