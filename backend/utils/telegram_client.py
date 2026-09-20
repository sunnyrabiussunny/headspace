"""
Minimal Telegram Bot API client. Each Headspace account connects its own
bot (created via @BotFather) and its own token — there's no shared bot, so
one account's messages can never reach another's diary.

Uses long-polling (getUpdates) rather than webhooks, since this app is
typically self-hosted on a home LAN with no public HTTPS endpoint for
Telegram to call.
"""
import httpx

API_BASE = "https://api.telegram.org"
TIMEOUT = 15.0


async def get_bot_info(token: str) -> dict:
    """Validates a bot token and returns {ok, username, first_name} or {ok: False, error}."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.get(f"{API_BASE}/bot{token}/getMe")
            data = resp.json()
            if not data.get("ok"):
                return {"ok": False, "error": data.get("description", "Invalid bot token")}
            result = data["result"]
            return {"ok": True, "username": result.get("username"), "first_name": result.get("first_name")}
    except Exception as e:
        return {"ok": False, "error": f"Couldn't reach Telegram: {type(e).__name__}"}


async def get_updates(token: str, offset: int = 0) -> list:
    """Fetch new messages since `offset` (short poll, timeout=0 — the
    background loop itself controls polling frequency, so we don't want
    Telegram's own long-poll blocking one user's turn in the loop)."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.get(
                f"{API_BASE}/bot{token}/getUpdates",
                params={"offset": offset, "timeout": 0, "allowed_updates": '["message"]'},
            )
            data = resp.json()
            if not data.get("ok"):
                return []
            return data.get("result", [])
    except Exception:
        return []


async def send_message(token: str, chat_id: str, text: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            await client.post(f"{API_BASE}/bot{token}/sendMessage", json={"chat_id": chat_id, "text": text})
    except Exception:
        pass   # best-effort confirmation reply; failure here shouldn't break entry creation
