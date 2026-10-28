import calendar
import hashlib
import os
import sqlite3
import secrets
import uuid
from datetime import date, datetime
from typing import Literal

from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import db
from .categorize import CATEGORIES, categorize, learn
from . import extract

TOKEN = os.environ.get("OKANE_TOKEN", "")
if len(TOKEN) < 16:
    raise RuntimeError("Set OKANE_TOKEN to a random string of at least 16 characters.")

MAX_IMAGE_BYTES = 5 * 1024 * 1024  # Claude's per-image limit
IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
EDITABLE = ("amount", "currency", "occurred_at", "recipient", "remark", "category", "payment_method")
PaymentMethod = Literal["shopee", "bca", "credit_card", ""]
Cycle = Literal["monthly", "yearly"]

db.init()
app = FastAPI(title="Okane")

# Only needed when the web app is served from a different origin (e.g. `expo start --web` on localhost:8081).
# In production Caddy serves the web build on the same origin, so leave this unset.
if os.environ.get("OKANE_CORS_ORIGINS"):
    app.add_middleware(
        CORSMiddleware,
        allow_origins=os.environ["OKANE_CORS_ORIGINS"].split(","),
        allow_methods=["*"],
        allow_headers=["Authorization", "Content-Type", "X-AI-Provider", "X-AI-Key", "X-AI-Model", "X-Anthropic-Key"],
    )


def require_token(authorization: str = Header("")) -> None:
    if not secrets.compare_digest(authorization.encode(), f"Bearer {TOKEN}".encode()):
        raise HTTPException(401, "Bad server token")


class ManualEntry(BaseModel):
    amount: float = Field(gt=0)
    category: str
    recipient: str = ""
    remark: str = ""
    payment_method: PaymentMethod = ""
    currency: str = "IDR"
    occurred_at: str | None = None


class Patch(BaseModel):
    amount: float | None = Field(None, gt=0)
    currency: str | None = None
    occurred_at: str | None = None
    recipient: str | None = None
    remark: str | None = None
    category: str | None = None
    payment_method: PaymentMethod | None = None


def row_out(row) -> dict:
    out = dict(row)
    out["has_image"] = out.pop("image_file") is not None
    out.pop("image_hash")
    return out


def get_row(conn, tx_id: int):
    row = conn.execute("SELECT * FROM transactions WHERE id = ?", (tx_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Not found")
    return row


def read_image(file: UploadFile) -> tuple[bytes, str]:
    """Validate an uploaded screenshot; returns its bytes and sha256."""
    if file.content_type not in IMAGE_TYPES:
        raise HTTPException(415, "Upload a JPEG, PNG or WebP screenshot.")
    image = file.file.read()
    if len(image) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image is over 5 MB.")
    return image, hashlib.sha256(image).hexdigest()


def check_duplicate(conn, image_hash: str, tx_id: int | None = None) -> None:
    dup = conn.execute("SELECT id FROM transactions WHERE image_hash = ? AND id IS NOT ?", (image_hash, tx_id)).fetchone()
    if dup:
        raise HTTPException(409, f"This screenshot was already added (#{dup['id']}).")


def check_category(category: str) -> None:
    if category not in CATEGORIES:
        raise HTTPException(422, f"Unknown category. Use one of: {', '.join(CATEGORIES)}")


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/capabilities", dependencies=[Depends(require_token)])
def capabilities():
    """server_scan: screenshots can be read here without the app sending an AI key."""
    return {"server_scan": bool(extract.CLAUDE_CLI)}


@app.get("/categories", dependencies=[Depends(require_token)])
def categories():
    return CATEGORIES


@app.get("/transactions", dependencies=[Depends(require_token)])
def list_transactions(month: str | None = None):
    """month: YYYY-MM. Omit for everything."""
    with db.connect() as conn:
        if month:
            rows = conn.execute(
                "SELECT * FROM transactions WHERE substr(occurred_at, 1, 7) = ? ORDER BY occurred_at DESC",
                (month,),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM transactions ORDER BY occurred_at DESC").fetchall()
    return [row_out(r) for r in rows]


@app.post("/transactions", dependencies=[Depends(require_token)])
def add_manual(entry: ManualEntry):
    check_category(entry.category)
    occurred_at = entry.occurred_at or datetime.now().isoformat(timespec="seconds")
    with db.connect() as conn:
        cur = conn.execute(
            "INSERT INTO transactions (amount, currency, occurred_at, recipient, remark, payment_method, category, "
            "category_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'manual')",
            (entry.amount, entry.currency, occurred_at, entry.recipient, entry.remark, entry.payment_method,
             entry.category),
        )
        if entry.recipient:
            learn(conn, entry.recipient, entry.category)
        return row_out(get_row(conn, cur.lastrowid))


@app.post("/transactions/scan", dependencies=[Depends(require_token)])
def scan(
    file: UploadFile = File(...),
    x_ai_provider: str = Header(""),  # anthropic | openrouter | gemini | openai | server
    x_ai_key: str = Header(""),
    x_ai_model: str = Header(""),
    x_anthropic_key: str = Header(""),  # older app versions
):
    provider, key = x_ai_provider, x_ai_key
    if not provider and x_anthropic_key:
        provider, key = "anthropic", x_anthropic_key
    if provider == "server":
        if not extract.CLAUDE_CLI:
            raise HTTPException(400, "This server has no Claude Code set up; pick another provider in Settings.")
    elif provider not in ("anthropic", *extract.OPENAI_COMPAT):
        raise HTTPException(400, "No AI provider set; add one in Settings or enter the expense manually.")
    elif not key:
        raise HTTPException(400, "No API key sent; add it in Settings.")
    image, image_hash = read_image(file)
    with db.connect() as conn:
        check_duplicate(conn, image_hash)

    try:
        if provider == "server":
            data = extract.extract_claude_cli(image, IMAGE_TYPES[file.content_type])
        elif provider == "anthropic":
            data = extract.extract_anthropic(image, file.content_type, key)
        else:
            data = extract.extract_openai_compat(image, file.content_type, provider, key, x_ai_model.strip())
    except extract.ProviderError as e:
        raise HTTPException(e.status, str(e))
    except extract.ExtractionError as e:
        raise HTTPException(422, str(e))

    if not data["is_receipt"] or data["amount"] <= 0:
        raise HTTPException(422, "Couldn't find a payment in this image.")

    occurred_at = data["occurred_at"] or datetime.now().isoformat(timespec="seconds")
    filename = uuid.uuid4().hex + IMAGE_TYPES[file.content_type]
    (db.IMAGE_DIR / filename).write_bytes(image)

    with db.connect() as conn:
        category, how = categorize(conn, data["recipient"], data["remark"], data["suggested_category"])
        cur = conn.execute(
            "INSERT INTO transactions (amount, currency, occurred_at, recipient, remark, source_app, "
            "payment_method, category, category_by, image_file, image_hash) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (data["amount"], data["currency"] or "IDR", occurred_at, data["recipient"], data["remark"],
             data["source_app"], data["payment_method"], category, how, filename, image_hash),
        )
        return row_out(get_row(conn, cur.lastrowid))


@app.patch("/transactions/{tx_id}", dependencies=[Depends(require_token)])
def update(tx_id: int, patch: Patch):
    changes = {k: v for k, v in patch.model_dump().items() if v is not None and k in EDITABLE}
    if "category" in changes:
        check_category(changes["category"])
        changes["category_by"] = "manual"
    with db.connect() as conn:
        row = get_row(conn, tx_id)
        if changes:
            sets = ", ".join(f"{k} = ?" for k in changes)
            conn.execute(f"UPDATE transactions SET {sets} WHERE id = ?", (*changes.values(), tx_id))
        if "category" in changes:
            learn(conn, changes.get("recipient", row["recipient"]), changes["category"])
        return row_out(get_row(conn, tx_id))


@app.delete("/transactions/{tx_id}", dependencies=[Depends(require_token)])
def delete(tx_id: int):
    with db.connect() as conn:
        row = get_row(conn, tx_id)
        conn.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))
    if row["image_file"]:
        (db.IMAGE_DIR / row["image_file"]).unlink(missing_ok=True)
    return {"deleted": tx_id}


@app.put("/transactions/{tx_id}/image", dependencies=[Depends(require_token)])
def attach_image(tx_id: int, file: UploadFile = File(...)):
    """Attach or replace the screenshot on any expense, without reading it with AI."""
    image, image_hash = read_image(file)
    with db.connect() as conn:
        row = get_row(conn, tx_id)
        check_duplicate(conn, image_hash, tx_id)
        filename = uuid.uuid4().hex + IMAGE_TYPES[file.content_type]
        (db.IMAGE_DIR / filename).write_bytes(image)
        conn.execute("UPDATE transactions SET image_file = ?, image_hash = ? WHERE id = ?", (filename, image_hash, tx_id))
        out = row_out(get_row(conn, tx_id))
    if row["image_file"]:
        (db.IMAGE_DIR / row["image_file"]).unlink(missing_ok=True)
    return out


@app.delete("/transactions/{tx_id}/image", dependencies=[Depends(require_token)])
def remove_image(tx_id: int):
    with db.connect() as conn:
        row = get_row(conn, tx_id)
        conn.execute("UPDATE transactions SET image_file = NULL, image_hash = NULL WHERE id = ?", (tx_id,))
        out = row_out(get_row(conn, tx_id))
    if row["image_file"]:
        (db.IMAGE_DIR / row["image_file"]).unlink(missing_ok=True)
    return out


@app.get("/transactions/{tx_id}/image", dependencies=[Depends(require_token)])
def image(tx_id: int):
    with db.connect() as conn:
        row = get_row(conn, tx_id)
    if not row["image_file"]:
        raise HTTPException(404, "No screenshot for this entry")
    return FileResponse(db.IMAGE_DIR / row["image_file"])


# --- Subscriptions -----------------------------------------------------------
# A subscription is a repeating bill. Each due date is a reminder until you mark it as spent,
# which creates a normal expense linked to (subscription_id, due_date).


class SubscriptionIn(BaseModel):
    name: str = Field(min_length=1)
    amount: float = Field(gt=0)
    category: str
    payment_method: PaymentMethod = ""
    cycle: Cycle
    start_date: date
    currency: str = "IDR"


class SubscriptionPatch(BaseModel):
    name: str | None = Field(None, min_length=1)
    amount: float | None = Field(None, gt=0)
    category: str | None = None
    payment_method: PaymentMethod | None = None
    cycle: Cycle | None = None
    start_date: date | None = None


class PayIn(BaseModel):
    due_date: date


def get_sub(conn, sub_id: int):
    row = conn.execute("SELECT * FROM subscriptions WHERE id = ?", (sub_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Subscription not found")
    return row


def due_in_month(sub, year: int, month: int) -> date | None:
    start = date.fromisoformat(sub["start_date"])
    if (year, month) < (start.year, start.month):
        return None
    if sub["cycle"] == "yearly" and month != start.month:
        return None
    # a bill on the 31st falls on the last day of shorter months
    return date(year, month, min(start.day, calendar.monthrange(year, month)[1]))


@app.get("/subscriptions", dependencies=[Depends(require_token)])
def list_subscriptions():
    with db.connect() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM subscriptions ORDER BY name COLLATE NOCASE")]


@app.post("/subscriptions", dependencies=[Depends(require_token)])
def add_subscription(sub: SubscriptionIn):
    check_category(sub.category)
    with db.connect() as conn:
        cur = conn.execute(
            "INSERT INTO subscriptions (name, amount, currency, category, payment_method, cycle, start_date) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (sub.name.strip(), sub.amount, sub.currency, sub.category, sub.payment_method, sub.cycle,
             sub.start_date.isoformat()),
        )
        return dict(get_sub(conn, cur.lastrowid))


@app.patch("/subscriptions/{sub_id}", dependencies=[Depends(require_token)])
def update_subscription(sub_id: int, patch: SubscriptionPatch):
    changes = {k: v for k, v in patch.model_dump().items() if v is not None}
    if "category" in changes:
        check_category(changes["category"])
    if "start_date" in changes:
        changes["start_date"] = changes["start_date"].isoformat()
    with db.connect() as conn:
        get_sub(conn, sub_id)
        if changes:
            sets = ", ".join(f"{k} = ?" for k in changes)
            conn.execute(f"UPDATE subscriptions SET {sets} WHERE id = ?", (*changes.values(), sub_id))
        return dict(get_sub(conn, sub_id))


@app.delete("/subscriptions/{sub_id}", dependencies=[Depends(require_token)])
def delete_subscription(sub_id: int):
    """Expenses already marked as spent stay; they were real payments."""
    with db.connect() as conn:
        get_sub(conn, sub_id)
        conn.execute("DELETE FROM subscriptions WHERE id = ?", (sub_id,))
    return {"deleted": sub_id}


@app.get("/subscriptions/due", dependencies=[Depends(require_token)])
def subscriptions_due(month: str = Query(pattern=r"^\d{4}-\d{2}$")):
    """Every subscription payment due in `month`, with the expense id if it was marked as spent."""
    year, mon = map(int, month.split("-"))
    with db.connect() as conn:
        subs = conn.execute("SELECT * FROM subscriptions").fetchall()
        paid = {
            (r["subscription_id"], r["due_date"]): r["id"]
            for r in conn.execute(
                "SELECT id, subscription_id, due_date FROM transactions "
                "WHERE subscription_id IS NOT NULL AND substr(due_date, 1, 7) = ?", (month,))
        }
    out = []
    for sub in subs:
        due = due_in_month(sub, year, mon)
        if due:
            out.append({"subscription": dict(sub), "due_date": due.isoformat(),
                        "transaction_id": paid.get((sub["id"], due.isoformat()))})
    return sorted(out, key=lambda d: (d["due_date"], d["subscription"]["name"].lower()))


@app.post("/subscriptions/{sub_id}/pay", dependencies=[Depends(require_token)])
def mark_spent(sub_id: int, body: PayIn):
    with db.connect() as conn:
        sub = get_sub(conn, sub_id)
        due = due_in_month(sub, body.due_date.year, body.due_date.month)
        if due != body.due_date:
            raise HTTPException(422, f"{sub['name']} isn't due on {body.due_date}.")
        try:
            cur = conn.execute(
                "INSERT INTO transactions (amount, currency, occurred_at, recipient, remark, payment_method, "
                "category, category_by, subscription_id, due_date) VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)",
                (sub["amount"], sub["currency"], f"{due.isoformat()}T00:00:00", sub["name"], "subscription",
                 sub["payment_method"], sub["category"], sub_id, due.isoformat()),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(409, "Already marked as spent.")
        return row_out(get_row(conn, cur.lastrowid))
