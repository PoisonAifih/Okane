import httpx

RATES_URL = "https://open.er-api.com/v6/latest/{}"  # free daily rates, no key


class RateError(Exception):
    pass


def convert(amount: float, src: str, dst: str) -> float:
    """`amount` in `src` expressed in `dst`, at today's rate."""
    if src == dst:
        return amount
    try:
        body = httpx.get(RATES_URL.format(src), timeout=10).json()
        rate = body["rates"][dst]
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        raise RateError(f"Couldn't get today's {src} to {dst} rate.")
    return amount * rate
