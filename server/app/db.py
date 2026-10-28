import os
import sqlite3
from pathlib import Path

DATA_DIR = Path(os.environ.get("OKANE_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
IMAGE_DIR = DATA_DIR / "screenshots"
DB_PATH = DATA_DIR / "okane.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    amount      REAL NOT NULL,
    currency    TEXT NOT NULL DEFAULT 'IDR',
    occurred_at TEXT NOT NULL,          -- ISO 8601
    recipient   TEXT NOT NULL DEFAULT '',
    remark      TEXT NOT NULL DEFAULT '',
    source_app  TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL,
    category_by TEXT NOT NULL,          -- manual | learned | keyword | ai
    image_file  TEXT,                   -- filename in IMAGE_DIR, NULL for manual entries
    image_hash  TEXT UNIQUE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- recipient -> category, learned from your corrections
CREATE TABLE IF NOT EXISTS learned_rules (
    recipient_key TEXT PRIMARY KEY,
    category      TEXT NOT NULL
);
"""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init() -> None:
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript(SCHEMA)
