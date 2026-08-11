from sqlalchemy import Column, String, Text, DateTime, JSON, Boolean
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

class DiaryEntry(Base):
    __tablename__ = "diary_entries"

    id          = Column(String, primary_key=True, default=new_id)
    user_id     = Column(String, nullable=True, index=True)
    date        = Column(String, nullable=False, index=True)   # YYYY-MM-DD
    content     = Column(Text, default="")
    tags        = Column(JSON, default=lambda: [])
    created_at  = Column(DateTime, default=utcnow)
    updated_at  = Column(DateTime, default=utcnow, onupdate=utcnow)

class KnowledgeObject(Base):
    __tablename__ = "knowledge_objects"

    id          = Column(String, primary_key=True, default=new_id)
    user_id     = Column(String, nullable=True, index=True)
    type        = Column(String, nullable=False)   # PERSON, PLACE, IDEA, ORGANIZATION, MEDIA, PAGE
    title       = Column(String, nullable=False)
    description = Column(Text, default="")
    notes       = Column(Text, default="")
    tags        = Column(JSON, default=lambda: [])
    properties  = Column(JSON, default=lambda: {})
    created_at  = Column(DateTime, default=utcnow)
    updated_at  = Column(DateTime, default=utcnow, onupdate=utcnow)

class Mention(Base):
    __tablename__ = "mentions"

    id          = Column(String, primary_key=True, default=new_id)
    user_id     = Column(String, nullable=True, index=True)
    object_id   = Column(String, nullable=False, index=True)
    source_type = Column(String, nullable=False)  # "diary" or "object"
    source_id   = Column(String, nullable=False, index=True)
    created_at  = Column(DateTime, default=utcnow)
