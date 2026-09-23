from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from database import get_db
from models.db_models import User
from auth import get_current_user
from utils.telegram_client import get_bot_info

router = APIRouter(prefix="/api/settings", tags=["settings"])


class AutoTagUpdate(BaseModel):
    enabled: bool

class AutoTaskUpdate(BaseModel):
    enabled: bool

class TelegramConnect(BaseModel):
    bot_token: str


@router.get("")
async def get_settings(current_user: User = Depends(get_current_user)):
    return {
        "auto_tag_enabled": current_user.auto_tag_enabled,
        "auto_task_enabled": current_user.auto_task_enabled,
        "telegram_connected": bool(current_user.telegram_bot_token),
        "telegram_linked": bool(current_user.telegram_chat_id),
    }


@router.put("/auto-tag")
async def set_auto_tag(payload: AutoTagUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    current_user.auto_tag_enabled = payload.enabled
    await db.commit()
    return {"auto_tag_enabled": current_user.auto_tag_enabled}


@router.put("/auto-task")
async def set_auto_task(payload: AutoTaskUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    current_user.auto_task_enabled = payload.enabled
    await db.commit()
    return {"auto_task_enabled": current_user.auto_task_enabled}


@router.post("/telegram")
async def connect_telegram(payload: TelegramConnect, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    token = payload.bot_token.strip()
    if not token:
        raise HTTPException(400, "Bot token required")

    info = await get_bot_info(token)
    if not info["ok"]:
        raise HTTPException(400, info["error"])

    current_user.telegram_bot_token = token
    current_user.telegram_chat_id = None       # reset — established by the first message the user sends
    current_user.telegram_last_update_id = 0
    await db.commit()
    return {"bot_username": info["username"]}


@router.delete("/telegram")
async def disconnect_telegram(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    current_user.telegram_bot_token = None
    current_user.telegram_chat_id = None
    current_user.telegram_last_update_id = 0
    await db.commit()
    return {"status": "ok"}
