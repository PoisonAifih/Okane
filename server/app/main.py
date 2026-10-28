import hashlib
import os
import secrets
import uuid
from datetime import datetime

import anthropic
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import db
from .categorize import CATEGORIES, categorize, learn
from .extract import ExtractionError, extract

TOKEN = os.environ.get("OKANE_TOKEN", "")
if len(TOKEN) < 16:
    raise RuntimeError("Set OKANE_TOKEN to a random string of at least 16 characters.")

MAX_IMAGE_BYTES = 5 * 1024 * 1024  # Claude's per-image limit
IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
EDITABLE = ("amount", "currency", "occurred_at", "recipient", "remark", "category")

db.init()
app = FastAPI(title="Okane")


def require_token(authorization: str = Header("")) -> None:
    if not secrets.compare_digest(authorization.encode(), f"Bearer {TOKEN}".encode()):
        raise HTTPException(401, "Bad server token")


class ManualEntry(BaseModel):
    amount: float = Field(gt=0)
    category: str
    recipient: str = ""
    remark: str = ""
    currency: str = "IDR"
    occurred_at: str | None = None


class Patch(BaseModel):
    amount: float | None = Field(None, gt=0)
    currency: str | None = None
    occurred_at: str | None = None
    recipient: str | None = None
    remark: str | None = None
    category: str | None = None


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


def check_category(category: str) -> None:
    if category not in CATEGORIES:
        raise HTTPException(422, f"Unknown category. Use one of: {', '.join(CATEGORIES)}")


@app.get("/health")
def health():
    return {"ok": True}


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
            "INSERT INTO transactions (amount, currency, occurred_at, recipient, remark, category, category_by) "
            "VALUES (?, ?, ?, ?, ?, ?, 'manual')",
            (entry.amount, entry.currency, occurred_at, entry.recipient, entry.remark, entry.category),
        )
        if entry.recipient:
            learn(conn, entry.recipient, entry.category)
        return row_out(get_row(conn, cur.lastrowid))


@app.post("/transactions/scan", dependencies=[Depends(require_token)])
def scan(file: UploadFile = File(...), x_anthropic_key: str = Header("")):
    if not x_anthropic_key:
        raise HTTPException(400, "No Anthropic API key sent; add it in Settings or enter the expense manually.")
    if file.content_type not in IMAGE_TYPES:
        raise HTTPException(415, "Upload a JPEG, PNG or WebP screenshot.")
    image = file.file.read()
    if len(image) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image is over 5 MB.")

    image_hash = hashlib.sha256(image).hexdigest()
    with db.connect() as conn:
        dup = conn.execute("SELECT id FROM transactions WHERE image_hash = ?", (image_hash,)).fetchone()
    if dup:
        raise HTTPException(409, f"This screenshot was already added (#{dup['id']}).")

    try:
        data = extract(image, file.content_type, x_anthropic_key)
    except anthropic.AuthenticationError:
        raise HTTPException(400, "Anthropic rejected the API key.")
    except anthropic.RateLimitError:
        raise HTTPException(429, "Anthropic rate limit hit; try again shortly.")
    except (anthropic.APIStatusError, anthropic.APIConnectionError) as e:
        raise HTTPException(502, f"Anthropic API error: {e}")
    except ExtractionError as e:
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
            "category, category_by, image_file, image_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (data["amount"], data["currency"] or "IDR", occurred_at, data["recipient"], data["remark"],
             data["source_app"], category, how, filename, image_hash),
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


@app.get("/transactions/{tx_id}/image", dependencies=[Depends(require_token)])
def image(tx_id: int):
    with db.connect() as conn:
        row = get_row(conn, tx_id)
    if not row["image_file"]:
        raise HTTPException(404, "No screenshot for this entry")
    return FileResponse(db.IMAGE_DIR / row["image_file"])
