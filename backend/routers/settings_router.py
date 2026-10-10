from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from database import get_db
from models.db_models import User
from auth import get_current_user
from utils.telegram_client import get_bot_info
from utils.ai_diary import list_ollama_models, list_openai_models, list_anthropic_models

router = APIRouter(prefix="/api/settings", tags=["settings"])


class AutoTagUpdate(BaseModel):
    enabled: bool

class AutoTaskUpdate(BaseModel):
    enabled: bool

class AutoCalendarImportUpdate(BaseModel):
    enabled: bool

class TelegramConnect(BaseModel):
    bot_token: str

class AIConfigUpdate(BaseModel):
    provider: Optional[str] = None             # "ollama" | "openai" | "anthropic"
    model: Optional[str] = None
    diary_context: Optional[str] = None
    # Each key field: omit to leave unchanged, "" to clear, a value to set.
    openai_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None


@router.get("")
async def get_settings(current_user: User = Depends(get_current_user)):
    return {
        "auto_tag_enabled": current_user.auto_tag_enabled,
        "auto_task_enabled": current_user.auto_task_enabled,
        "auto_calendar_import_enabled": current_user.auto_calendar_import_enabled,
        "telegram_connected": bool(current_user.telegram_bot_token),
        "telegram_linked": bool(current_user.telegram_chat_id),
        "ai_provider": current_user.ai_provider or "ollama",
        "ai_model": current_user.ai_model,
        "ai_diary_context": current_user.ai_diary_context or "",
        "has_openai_key": bool(current_user.openai_api_key),
        "has_anthropic_key": bool(current_user.anthropic_api_key),
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


@router.put("/auto-calendar-import")
async def set_auto_calendar_import(payload: AutoCalendarImportUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    current_user.auto_calendar_import_enabled = payload.enabled
    await db.commit()
    return {"auto_calendar_import_enabled": current_user.auto_calendar_import_enabled}


@router.put("/ai-config")
async def set_ai_config(payload: AIConfigUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if payload.provider is not None:
        if payload.provider not in ("ollama", "openai", "anthropic"):
            raise HTTPException(400, "provider must be 'ollama', 'openai', or 'anthropic'")
        current_user.ai_provider = payload.provider
    if payload.model is not None:
        current_user.ai_model = payload.model.strip() or None
    if payload.diary_context is not None:
        current_user.ai_diary_context = payload.diary_context
    if payload.openai_api_key is not None:
        current_user.openai_api_key = payload.openai_api_key.strip() or None
    if payload.anthropic_api_key is not None:
        current_user.anthropic_api_key = payload.anthropic_api_key.strip() or None
    await db.commit()
    return {
        "ai_provider": current_user.ai_provider,
        "ai_model": current_user.ai_model,
        "ai_diary_context": current_user.ai_diary_context or "",
        "has_openai_key": bool(current_user.openai_api_key),
        "has_anthropic_key": bool(current_user.anthropic_api_key),
    }


@router.get("/ai-models")
async def get_ai_models(current_user: User = Depends(get_current_user)):
    """Live-queries each provider so newly installed Ollama models (or a
    freshly-saved API key) show up immediately — nothing here is cached."""
    ollama_models, ollama_error = await list_ollama_models()
    openai_models, openai_error = await list_openai_models(current_user.openai_api_key)
    anthropic_models, anthropic_error = await list_anthropic_models(current_user.anthropic_api_key)
    return {
        "ollama":    {"models": ollama_models,    "error": ollama_error},
        "openai":    {"models": openai_models,    "error": openai_error},
        "anthropic": {"models": anthropic_models, "error": anthropic_error},
    }


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
