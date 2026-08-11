"""
Lightweight auth: password hashing (PBKDF2, stdlib-only) + HMAC-signed
session tokens (stdlib-only). No extra pip dependencies required, so this
doesn't add any new packages to the Docker build.
"""
import os
import hmac
import hashlib
import base64
import json
import time
import secrets

from fastapi import Depends, HTTPException, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.db_models import User

SECRET_KEY = os.getenv("SECRET_KEY", "headspace-secret-change-me")
TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30  # 30 days

PBKDF2_ITERATIONS = 260_000


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PBKDF2_ITERATIONS)
    return base64.b64encode(digest).decode(), salt


def verify_password(password: str, stored_hash: str, salt: str) -> bool:
    candidate, _ = hash_password(password, salt)
    return hmac.compare_digest(candidate, stored_hash)


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def create_token(user_id: str) -> str:
    payload = {"uid": user_id, "exp": int(time.time()) + TOKEN_TTL_SECONDS}
    body = _b64url_encode(json.dumps(payload).encode())
    sig = _b64url_encode(hmac.new(SECRET_KEY.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def decode_token(token: str) -> str:
    """Returns user_id if the token is valid and unexpired, else raises."""
    try:
        body, sig = token.split(".")
        expected_sig = _b64url_encode(hmac.new(SECRET_KEY.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected_sig):
            raise ValueError("bad signature")
        payload = json.loads(_b64url_decode(body))
        if payload.get("exp", 0) < time.time():
            raise ValueError("expired")
        return payload["uid"]
    except Exception:
        raise HTTPException(401, "Invalid or expired session")


async def get_current_user(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    token = authorization[len("Bearer "):]
    user_id = decode_token(token)
    r = await db.execute(select(User).where(User.id == user_id))
    user = r.scalar_one_or_none()
    if not user:
        raise HTTPException(401, "User no longer exists")
    return user
