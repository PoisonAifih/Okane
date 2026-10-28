import re
import sqlite3

CATEGORIES = [
    "food",
    "groceries",
    "transport",
    "shopping",
    "bills",
    "entertainment",
    "health",
    "education",
    "transfer",
    "topup",
    "other",
]

# Checked in order; first match wins. Matched against recipient + remark, lowercased.
KEYWORD_RULES: list[tuple[str, list[str]]] = [
    ("topup", ["top up", "topup", "isi saldo"]),
    ("food", ["gofood", "grabfood", "shopeefood", "warung", "warteg", "resto", "restaurant", "cafe",
              "kopi", "coffee", "bakso", "mie ", "nasi", "ayam", "sate", "martabak", "mcd", "kfc", "starbucks"]),
    ("groceries", ["indomaret", "alfamart", "alfamidi", "superindo", "hypermart", "transmart", "lotte mart"]),
    ("transport", ["gojek", "goride", "gocar", "grab", "maxim", "krl", "mrt", "transjakarta", "kai ",
                   "pertamina", "shell", "bensin", "parkir", "tol "]),
    ("bills", ["pln", "listrik", "pdam", "indihome", "biznet", "pulsa", "paket data", "bpjs",
               "telkomsel", "xl ", "kos", "sewa"]),
    ("entertainment", ["netflix", "spotify", "youtube", "steam", "cinema", "xxi", "cgv", "game", "disney"]),
    ("shopping", ["tokopedia", "shopee", "lazada", "blibli", "tiktok shop", "uniqlo"]),
    ("health", ["apotek", "kimia farma", "klinik", "rumah sakit", "dokter", "halodoc"]),
    ("education", ["kursus", "sekolah", "kampus", "udemy", "buku"]),
]


def recipient_key(recipient: str) -> str:
    return re.sub(r"\s+", " ", recipient.strip().lower())


def categorize(conn: sqlite3.Connection, recipient: str, remark: str, ai_guess: str | None) -> tuple[str, str]:
    """Return (category, how). Your corrections beat keywords, keywords beat the AI's guess."""
    key = recipient_key(recipient)
    if key:
        row = conn.execute("SELECT category FROM learned_rules WHERE recipient_key = ?", (key,)).fetchone()
        if row:
            return row["category"], "learned"

    text = f" {recipient} {remark} ".lower()
    for category, words in KEYWORD_RULES:
        if any(w in text for w in words):
            return category, "keyword"

    if ai_guess in CATEGORIES:
        return ai_guess, "ai"
    return "other", "ai"


def learn(conn: sqlite3.Connection, recipient: str, category: str) -> None:
    key = recipient_key(recipient)
    if key:
        conn.execute(
            "INSERT INTO learned_rules (recipient_key, category) VALUES (?, ?) "
            "ON CONFLICT(recipient_key) DO UPDATE SET category = excluded.category",
            (key, category),
        )
