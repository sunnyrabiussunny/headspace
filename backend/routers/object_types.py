from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import Column, String, Integer, Boolean, DateTime, select, delete
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import re
import uuid

from database import get_db, engine
from models.db_models import Base, User, KnowledgeObject
from auth import get_current_user

router = APIRouter(prefix="/api/object-types", tags=["object-types"])

MAX_TYPES = 30

# ── DB Model ─────────────────────────────────────────────────────────────────

class ObjectType(Base):
    __tablename__ = "object_types"
    id         = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id    = Column(String, nullable=True, index=True)
    key        = Column(String, nullable=False)     # e.g. "RECORDING", uppercase, no spaces
    label      = Column(String, nullable=False)      # e.g. "Recordings"
    icon       = Column(String, nullable=False, default="📄")
    is_default = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

async def init_object_type_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

DEFAULT_TYPES = [
    ("PERSON",       "Person",        "👤"),
    ("PLACE",        "Place",         "📍"),
    ("IDEA",         "Idea",          "💡"),
    ("ORGANIZATION", "Organization",  "🏢"),
    ("MEDIA",        "Media",         "🎬"),
    ("PAGE",         "Page",          "📄"),
    ("RECORDING",    "Recordings",    "🎙️"),
]

def _to_key(label: str) -> str:
    return re.sub(r'[^A-Z0-9_]', '', re.sub(r'\s+', '_', label.strip().upper()))

async def seed_default_types(db: AsyncSession, user_id: str):
    existing = await db.execute(select(ObjectType).where(ObjectType.user_id == user_id))
    if existing.scalars().first():
        return
    for i, (key, label, icon) in enumerate(DEFAULT_TYPES):
        db.add(ObjectType(id=str(uuid.uuid4()), user_id=user_id, key=key, label=label,
                           icon=icon, is_default=True, sort_order=i))
    await db.commit()

# ── Schemas ──────────────────────────────────────────────────────────────────

class TypeCreate(BaseModel):
    label: str
    icon: str = "📄"

# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("")
async def list_types(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await seed_default_types(db, current_user.id)
    r = await db.execute(
        select(ObjectType).where(ObjectType.user_id == current_user.id).order_by(ObjectType.sort_order, ObjectType.created_at)
    )
    return [{"key": t.key, "label": t.label, "icon": t.icon, "is_default": t.is_default} for t in r.scalars().all()]


@router.post("", status_code=201)
async def create_type(payload: TypeCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    label = payload.label.strip()
    if not label:
        raise HTTPException(400, "Label required")
    key = _to_key(label)
    if not key:
        raise HTTPException(400, "Label must contain letters or numbers")

    count_r = await db.execute(select(ObjectType).where(ObjectType.user_id == current_user.id))
    existing_types = count_r.scalars().all()
    if len(existing_types) >= MAX_TYPES:
        raise HTTPException(400, f"Maximum of {MAX_TYPES} object types allowed")
    if any(t.key == key for t in existing_types):
        raise HTTPException(400, f'An object type called "{label}" already exists')

    t = ObjectType(id=str(uuid.uuid4()), user_id=current_user.id, key=key, label=label,
                    icon=payload.icon or "📄", is_default=False, sort_order=len(existing_types))
    db.add(t); await db.commit()
    return {"key": t.key, "label": t.label, "icon": t.icon, "is_default": t.is_default}


@router.delete("/{key}", status_code=204)
async def delete_type(key: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(ObjectType).where(ObjectType.key == key, ObjectType.user_id == current_user.id))
    t = r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Type not found")
    if t.is_default:
        raise HTTPException(400, "Built-in object types can't be deleted")
    in_use = await db.execute(select(KnowledgeObject).where(KnowledgeObject.type == key, KnowledgeObject.user_id == current_user.id))
    if in_use.scalars().first():
        raise HTTPException(400, "Can't delete a type that still has objects — move or delete those objects first")
    await db.execute(delete(ObjectType).where(ObjectType.id == t.id))
    await db.commit()
