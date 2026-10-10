from sqlalchemy import Column, String, Text, DateTime, JSON, Boolean, Integer
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime, timezone
import uuid

Base = declarative_base()

def new_id():
    return str(uuid.uuid4())

def utcnow():
    """Return current UTC time (naive, stored as UTC)."""
    return datetime.utcnow()

class User(Base):
    __tablename__ = "users"

    id            = Column(String, primary_key=True, default=new_id)
    username      = Column(String, nullable=False, unique=True, index=True)
    display_name  = Column(String, nullable=False, default="")
    password_hash = Column(String, nullable=False)
    password_salt = Column(String, nullable=False)
    is_admin      = Column(Boolean, default=False)
    created_at    = Column(DateTime, default=utcnow)

    # Background auto-tag toggle (Settings → Automation)
    auto_tag_enabled       = Column(Boolean, default=False)

    # Background automatic task creation toggle (Settings → Automation)
    auto_task_enabled      = Column(Boolean, default=False)

    # Auto-import today's calendar events into the diary (Settings → Automation)
    auto_calendar_import_enabled = Column(Boolean, default=False)

    # AI Diary Writer — turns an imported calendar event into a humanized,
    # first-person diary paragraph instead of a mechanical title/location
    # dump (Settings → Automation → AI Diary Writer).
    ai_provider        = Column(String, default="ollama")   # "ollama" | "openai" | "anthropic"
    ai_model           = Column(String, nullable=True)       # model name/id for the chosen provider
    ai_diary_context   = Column(Text, nullable=True)         # free-text personal background fed into the prompt
    openai_api_key     = Column(String, nullable=True)
    anthropic_api_key  = Column(String, nullable=True)

    # Telegram bot link (Settings → Telegram) — each user connects their own bot
    telegram_bot_token     = Column(String, nullable=True)
    telegram_chat_id       = Column(String, nullable=True)
    telegram_last_update_id = Column(Integer, default=0)

class DiaryEntry(Base):
    __tablename__ = "diary_entries"

    id          = Column(String, primary_key=True, default=new_id)
    user_id     = Column(String, nullable=True, index=True)
    date        = Column(String, nullable=False, index=True)   # YYYY-MM-DD
    content     = Column(Text, default="")
    tags        = Column(JSON, default=lambda: [])
    created_at  = Column(DateTime, default=utcnow)
    updated_at  = Column(DateTime, default=utcnow, onupdate=utcnow)
    auto_tagged_at = Column(DateTime, nullable=True)   # last time the background auto-tagger processed this
    task_scanned_at = Column(DateTime, nullable=True)  # once set, automatic task-scanning skips this entry forever (force-rescan via button resets it)

class KnowledgeObject(Base):
    __tablename__ = "knowledge_objects"

    id          = Column(String, primary_key=True, default=new_id)
    user_id     = Column(String, nullable=True, index=True)
    type        = Column(String, nullable=False)   # PERSON, PLACE, IDEA, ORGANIZATION, MEDIA, PAGE, RECORDING
    title       = Column(String, nullable=False)
    description = Column(Text, default="")
    notes       = Column(Text, default="")
    tags        = Column(JSON, default=lambda: [])
    properties  = Column(JSON, default=lambda: {})
    created_at  = Column(DateTime, default=utcnow)
    updated_at  = Column(DateTime, default=utcnow, onupdate=utcnow)
    auto_tagged_at = Column(DateTime, nullable=True)   # last time the background auto-tagger processed this

class Mention(Base):
    __tablename__ = "mentions"

    id          = Column(String, primary_key=True, default=new_id)
    user_id     = Column(String, nullable=True, index=True)
    object_id   = Column(String, nullable=False, index=True)
    source_type = Column(String, nullable=False)  # "diary" or "object"
    source_id   = Column(String, nullable=False, index=True)
    created_at  = Column(DateTime, default=utcnow)
