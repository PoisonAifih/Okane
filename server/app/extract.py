"""Read a payment screenshot with an AI model.

Three routes, all returning the same normalized list of payments (one for a receipt, one per row
of a transaction history):
- Anthropic API (official SDK, structured output)
- OpenAI-compatible APIs: OpenRouter, Gemini, OpenAI (raw HTTP, JSON asked for in the prompt)
- Claude Code CLI on this machine (`claude -p`), for personal use with your own Claude login
"""
import base64
import json
import os
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

import anthropic
import httpx

from .categorize import CATEGORIES

MODEL = "claude-opus-5-5"
PAYMENT_METHODS = ["shopee", "bca", "credit_card"]

# OpenAI-style chat completion endpoints; the device picks one by name and sends its own key.
OPENAI_COMPAT = {
    "openrouter": ("OpenRouter", "https://openrouter.ai/api/v1/chat/completions"),
    "gemini": ("Gemini", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"),
    "openai": ("OpenAI", "https://api.openai.com/v1/chat/completions"),
}

# Path to the `claude` binary; unset disables the server-side route.
CLAUDE_CLI = os.environ.get("OKANE_CLAUDE_CLI", "")

PROMPT = f"""This is a screenshot from a bank or e-wallet app (often Indonesian, e.g. BCA, Mandiri, BRI, \
GoPay, OVO, DANA, ShopeePay, QRIS). It is either a single payment receipt or a transaction history \
listing several transactions.

List every payment where money went OUT: purchases, bills, transfers sent. Skip money coming IN \
(top-ups shown as incoming such as "Isi Saldo" with a +, cashback, refunds, transfers received) and \
skip rows cut off so that their amount isn't visible. If nothing qualifies, return an empty list.

For each payment:
- amount: the amount paid, as a plain number (Rp 25.000 -> 25000).
- currency: ISO 4217 code of the amount shown (IDR for Rp, USD for $, ...).
- occurred_at: date-time as ISO 8601 (YYYY-MM-DDTHH:MM:SS); if only the date is shown use T00:00:00. \
Empty string if no date is shown.
- recipient: the merchant or person paid. Do NOT include account numbers.
- remark: the note / berita / keterangan the payer wrote, if any.
- source_app: which bank or e-wallet the screenshot is from.
- payment_method: "shopee" for Shopee / ShopeePay / SPayLater, "bca" for a BCA bank transfer or BCA QRIS, \
"credit_card" if paid by credit card, empty string if none of these.
- suggested_category: best guess, one of: {", ".join(CATEGORIES)}.
- top, bottom: where this payment's row or card starts and ends vertically, as a percentage of the \
image height (0 = top edge, 100 = bottom edge). For a single receipt use 0 and 100."""

PAYMENT = {
    "type": "object",
    "properties": {
        "amount": {"type": "number"},
        "currency": {"type": "string"},
        "occurred_at": {"type": "string"},
        "recipient": {"type": "string"},
        "remark": {"type": "string"},
        "source_app": {"type": "string"},
        "payment_method": {"type": "string", "enum": [*PAYMENT_METHODS, ""]},
        "suggested_category": {"type": "string", "enum": CATEGORIES},
        "top": {"type": "number"},
        "bottom": {"type": "number"},
    },
    "required": ["amount", "currency", "occurred_at", "recipient", "remark", "source_app",
                 "payment_method", "suggested_category", "top", "bottom"],
    "additionalProperties": False,
}
SCHEMA = {
    "type": "object",
    "properties": {"payments": {"type": "array", "items": PAYMENT}},
    "required": ["payments"],
    "additionalProperties": False,
}

# For routes without enforced structured output.
JSON_PROMPT = PROMPT + "\n\nReply with only a JSON object with exactly these keys, no other text:\n" + json.dumps(SCHEMA)


class ExtractionError(Exception):
    pass


class ProviderError(Exception):
    """Upstream failure, carrying the HTTP status to return to the app."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def normalize(result: dict) -> list[dict]:
    """Clean each payment; drop ones without an amount."""
    items = result.get("payments") if isinstance(result, dict) else None
    out = [normalize_one(d) for d in items or [] if isinstance(d, dict)]
    return [d for d in out if d["amount"] > 0]


def number(v, default: float) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def normalize_one(d: dict) -> dict:
    def text(k: str) -> str:
        v = d.get(k)
        return v.strip() if isinstance(v, str) else ""

    amount = number(d.get("amount"), 0.0)
    top = min(max(number(d.get("top"), 0.0), 0.0), 100.0)
    bottom = min(max(number(d.get("bottom"), 100.0), 0.0), 100.0)
    occurred_at = text("occurred_at")
    try:
        datetime.fromisoformat(occurred_at)
    except ValueError:
        occurred_at = ""
    method, category = text("payment_method"), text("suggested_category")
    return {
        "amount": amount,
        "currency": text("currency").upper(),  # "" = not shown; the server assumes your home currency
        "occurred_at": occurred_at,
        "recipient": text("recipient"),
        "remark": text("remark"),
        "source_app": text("source_app"),
        "payment_method": method if method in PAYMENT_METHODS else "",
        "suggested_category": category if category in CATEGORIES else None,
        "top": top,
        "bottom": bottom if bottom > top else 100.0,
    }


def parse_json(text: str) -> dict:
    """Models without structured output sometimes wrap the JSON in prose or a code fence."""
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ExtractionError("The model didn't return JSON.")
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        raise ExtractionError("The model returned malformed JSON.")


def extract_anthropic(image: bytes, media_type: str, api_key: str) -> list[dict]:
    client = anthropic.Anthropic(api_key=api_key)
    try:
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=8000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {
                        "type": "base64", "media_type": media_type,
                        "data": base64.standard_b64encode(image).decode(),
                    }},
                    {"type": "text", "text": PROMPT},
                ],
            }],
        )
    except anthropic.AuthenticationError:
        raise ProviderError(400, "Anthropic rejected the API key.")
    except anthropic.RateLimitError:
        raise ProviderError(429, "Anthropic rate limit hit; try again shortly.")
    except (anthropic.APIStatusError, anthropic.APIConnectionError) as e:
        raise ProviderError(502, f"Anthropic API error: {e}")
    if response.stop_reason == "refusal":
        raise ExtractionError("The model declined to read this image.")
    text = next((b.text for b in response.content if b.type == "text"), None)
    if text is None:
        raise ExtractionError(f"No result (stop_reason={response.stop_reason}).")
    return normalize(json.loads(text))


def extract_openai_compat(image: bytes, media_type: str, provider: str, api_key: str, model: str) -> list[dict]:
    name, url = OPENAI_COMPAT[provider]
    if not model:
        raise ProviderError(400, f"Set a model for {name} in Settings.")
    data_url = f"data:{media_type};base64,{base64.standard_b64encode(image).decode()}"
    try:
        r = httpx.post(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
            json={"model": model, "messages": [{"role": "user", "content": [
                {"type": "text", "text": JSON_PROMPT},
                {"type": "image_url", "image_url": {"url": data_url}},
            ]}]},
            timeout=120,
        )
    except httpx.RequestError as e:
        raise ProviderError(502, f"Couldn't reach {name}: {e}")
    if r.status_code in (401, 403):
        raise ProviderError(400, f"{name} rejected the API key.")
    if r.status_code == 429:
        raise ProviderError(429, f"{name} rate limit hit; try again shortly.")
    if r.status_code >= 400:
        raise ProviderError(502, f"{name} error {r.status_code}: {r.text[:300]}")
    try:
        text = r.json()["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError):
        raise ExtractionError(f"Unexpected response from {name}.")
    return normalize(parse_json(text or ""))


def extract_claude_cli(image: bytes, ext: str) -> list[dict]:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"receipt{ext}"
        path.write_bytes(image)
        try:
            proc = subprocess.run(
                [CLAUDE_CLI, "-p", f"Read the image file {path.name}.\n\n{JSON_PROMPT}",
                 "--output-format", "json", "--allowedTools", "Read"],
                cwd=tmp, capture_output=True, text=True, timeout=180,
            )
        except FileNotFoundError:
            raise ProviderError(500, f"Claude Code not found at {CLAUDE_CLI}.")
        except subprocess.TimeoutExpired:
            raise ProviderError(504, "Claude Code took too long to read the screenshot.")
    try:
        out = json.loads(proc.stdout)
    except json.JSONDecodeError:
        raise ProviderError(502, f"Claude Code failed: {(proc.stderr or proc.stdout)[:300]}")
    if out.get("is_error"):
        raise ProviderError(502, f"Claude Code error: {str(out.get('result'))[:300]}")
    return normalize(parse_json(out.get("result") or ""))
