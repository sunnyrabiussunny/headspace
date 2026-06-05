from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, or_
from typing import List, Optional
from datetime import datetime
import uuid

from database import get_db
from models.db_models import KnowledgeObject, Mention
from models.schemas import ObjectCreate, ObjectUpdate, ObjectOut, MentionOut
from utils.mentions import extract_mentions

router = APIRouter(prefix="/api/objects", tags=["objects"])

VALID_TYPES = {"PERSON", "PLACE", "IDEA", "ORGANIZATION"}


@router.get("/", response_model=List[ObjectOut])
async def list_objects(type: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    q = select(KnowledgeObject).order_by(KnowledgeObject.updated_at.desc())
    if type:
        q = q.where(KnowledgeObject.type == type.upper())
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/search", response_model=List[ObjectOut])
async def search_objects(q: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(KnowledgeObject).where(
            or_(
                KnowledgeObject.title.ilike(f"%{q}%"),
                KnowledgeObject.description.ilike(f"%{q}%"),
                KnowledgeObject.notes.ilike(f"%{q}%"),
            )
        ).order_by(KnowledgeObject.title.asc()).limit(20)
    )
    return result.scalars().all()


@router.get("/mention-search", response_model=List[ObjectOut])
async def mention_search(q: str, db: AsyncSession = Depends(get_db)):
    """Fast title-only search used by @mention popup."""
    result = await db.execute(
        select(KnowledgeObject)
        .where(KnowledgeObject.title.ilike(f"%{q}%"))
        .order_by(KnowledgeObject.title.asc())
        .limit(8)
    )
    return result.scalars().all()


@router.get("/{object_id}", response_model=ObjectOut)
async def get_object(object_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(KnowledgeObject).where(KnowledgeObject.id == object_id)
    )
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(404, "Object not found")
    return obj


@router.get("/{object_id}/mentions", response_model=List[MentionOut])
async def get_mentions(object_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Mention)
        .where(Mention.object_id == object_id)
        .order_by(Mention.created_at.desc())
    )
    return result.scalars().all()


@router.post("/", response_model=ObjectOut, status_code=201)
async def create_object(payload: ObjectCreate, db: AsyncSession = Depends(get_db)):
    if payload.type.upper() not in VALID_TYPES:
        raise HTTPException(400, f"Invalid type. Must be one of: {', '.join(VALID_TYPES)}")
    obj = KnowledgeObject(
        id=str(uuid.uuid4()),
        type=payload.type.upper(),
        title=payload.title,
        description=payload.description,
        notes=payload.notes,
        tags=payload.tags,
        properties=payload.properties,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    # Sync mentions in notes
    await _sync_mentions(db, obj)
    return obj


@router.put("/{object_id}", response_model=ObjectOut)
async def update_object(
    object_id: str, payload: ObjectUpdate, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(KnowledgeObject).where(KnowledgeObject.id == object_id)
    )
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(404, "Object not found")

    if payload.title is not None:
        obj.title = payload.title
    if payload.description is not None:
        obj.description = payload.description
    if payload.notes is not None:
        obj.notes = payload.notes
    if payload.tags is not None:
        obj.tags = payload.tags
    if payload.properties is not None:
        obj.properties = payload.properties
    obj.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(obj)
    # Re-sync mentions whenever notes change
    await _sync_mentions(db, obj)
    return obj


@router.delete("/{object_id}", status_code=204)
async def delete_object(object_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Mention).where(Mention.object_id == object_id))
    await db.execute(delete(Mention).where(Mention.source_id == object_id))
    await db.execute(
        delete(KnowledgeObject).where(KnowledgeObject.id == object_id)
    )
    await db.commit()


# ── Helper ────────────────────────────────────────────────────────────────────

async def _sync_mentions(db: AsyncSession, obj: KnowledgeObject):
    """Re-parse @mentions in object notes and update mention records."""
    # Remove old mentions from this object's notes as source
    await db.execute(
        delete(Mention).where(
            Mention.source_id == obj.id,
            Mention.source_type == "object"
        )
    )
    # Parse and insert new mentions
    mentions = extract_mentions(obj.notes or "")
    for _name, target_id in mentions:
        # Don't create self-referencing mention
        if target_id == obj.id:
            continue
        db.add(Mention(
            id=str(uuid.uuid4()),
            object_id=target_id,
            source_type="object",
            source_id=obj.id,
        ))
    await db.commit()
