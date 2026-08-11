from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional

from database import get_db
from models.db_models import User, new_id
from auth import hash_password, verify_password, create_token, get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _user_out(u: User) -> dict:
    return {"id": u.id, "username": u.username, "display_name": u.display_name or u.username, "is_admin": u.is_admin}


class LoginRequest(BaseModel):
    username: str
    password: str


class CreateUserRequest(BaseModel):
    username: str
    password: str
    display_name: str = ""


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/login")
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    uname = payload.username.strip().lower()
    r = await db.execute(select(User).where(User.username == uname))
    user = r.scalar_one_or_none()
    if not user or not verify_password(payload.password, user.password_hash, user.password_salt):
        raise HTTPException(401, "Incorrect username or password")
    token = create_token(user.id)
    return {"token": token, "user": _user_out(user)}


@router.get("/me")
async def me(current_user: User = Depends(get_current_user)):
    return _user_out(current_user)


@router.get("/users")
async def list_users(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Just usernames/display names — no password data — so the account switcher/manage screen can show who has access."""
    r = await db.execute(select(User).order_by(User.created_at))
    return [_user_out(u) for u in r.scalars().all()]


@router.post("/users", status_code=201)
async def create_user(
    payload: CreateUserRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Any logged-in user can add another account (e.g. adding a spouse's login).
    Each account gets fully separate, isolated data."""
    uname = payload.username.strip().lower()
    if not uname or len(payload.password) < 4:
        raise HTTPException(400, "Username required and password must be at least 4 characters")
    existing = await db.execute(select(User).where(User.username == uname))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "That username is already taken")
    pw_hash, salt = hash_password(payload.password)
    user = User(
        id=new_id(), username=uname,
        display_name=payload.display_name.strip() or uname,
        password_hash=pw_hash, password_salt=salt, is_admin=False,
    )
    db.add(user)
    await db.commit()
    return _user_out(user)


@router.put("/me/password")
async def change_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(payload.current_password, current_user.password_hash, current_user.password_salt):
        raise HTTPException(400, "Current password is incorrect")
    if len(payload.new_password) < 4:
        raise HTTPException(400, "New password must be at least 4 characters")
    pw_hash, salt = hash_password(payload.new_password)
    current_user.password_hash = pw_hash
    current_user.password_salt = salt
    await db.commit()
    return {"status": "ok"}
