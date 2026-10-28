import base64
import json

import anthropic

from .categorize import CATEGORIES

MODEL = "claude-opus-5-5"

PROMPT = f"""This is a screenshot of a payment or transfer receipt from a bank or e-wallet app \
(often Indonesian, e.g. BCA, Mandiri, BRI, GoPay, OVO, DANA, ShopeePay, QRIS).

Extract:
- amount: the amount paid, as a plain number (Rp 25.000 -> 25000). 0 if not visible.
- currency: ISO code, usually IDR.
- occurred_at: transaction date-time as ISO 8601 (YYYY-MM-DDTHH:MM:SS). Empty string if not shown.
- recipient: the merchant or person paid. Do NOT include account numbers.
- remark: the note / berita / keterangan the payer wrote, if any.
- source_app: which bank or e-wallet the receipt is from.
- suggested_category: best guess, one of: {", ".join(CATEGORIES)}.
- is_receipt: false if the image is not a payment receipt at all."""

SCHEMA = {
    "type": "object",
    "properties": {
        "amount": {"type": "number"},
        "currency": {"type": "string"},
        "occurred_at": {"type": "string"},
        "recipient": {"type": "string"},
        "remark": {"type": "string"},
        "source_app": {"type": "string"},
        "suggested_category": {"type": "string", "enum": CATEGORIES},
        "is_receipt": {"type": "boolean"},
    },
    "required": ["amount", "currency", "occurred_at", "recipient", "remark",
                 "source_app", "suggested_category", "is_receipt"],
    "additionalProperties": False,
}


class ExtractionError(Exception):
    pass


def extract(image: bytes, media_type: str, api_key: str) -> dict:
    client = anthropic.Anthropic(api_key=api_key)
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=4000,
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
    if response.stop_reason == "refusal":
        raise ExtractionError("The model declined to read this image.")
    text = next((b.text for b in response.content if b.type == "text"), None)
    if text is None:
        raise ExtractionError(f"No result (stop_reason={response.stop_reason}).")
    return json.loads(text)
