from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, or_, update
from sqlalchemy.orm.attributes import flag_modified
from typing import List, Optional
from datetime import datetime
import uuid
import re

from database import get_db
from models.db_models import KnowledgeObject, Mention, DiaryEntry
from models.schemas import ObjectCreate, ObjectUpdate, ObjectOut, MentionOut, MergeRequest
from utils.mentions import extract_mentions

router = APIRouter(prefix="/api/objects", tags=["objects"])

VALID_TYPES = {"PERSON", "PLACE", "IDEA", "ORGANIZATION", "MEDIA"}


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
    result = await db.execute(
        select(KnowledgeObject)
        .where(KnowledgeObject.title.ilike(f"%{q}%"))
        .order_by(KnowledgeObject.title.asc())
        .limit(8)
    )
    return result.scalars().all()


@router.post("/merge", response_model=ObjectOut)
async def merge_objects(payload: MergeRequest, db: AsyncSession = Depends(get_db)):
    """Merge source into target: all mentions of source become mentions of target, then source is deleted."""
    src_result = await db.execute(select(KnowledgeObject).where(KnowledgeObject.id == payload.source_id))
    src = src_result.scalar_one_or_none()
    if not src:
        raise HTTPException(404, "Source object not found")

    tgt_result = await db.execute(select(KnowledgeObject).where(KnowledgeObject.id == payload.target_id))
    tgt = tgt_result.scalar_one_or_none()
    if not tgt:
        raise HTTPException(404, "Target object not found")

    # Re-point all Mention rows that reference source → target
    await db.execute(
        update(Mention)
        .where(Mention.object_id == payload.source_id)
        .values(object_id=payload.target_id)
    )

    # Update diary entries: replace @[title](source_id) → @[target_title](target_id)
    diary_result = await db.execute(select(DiaryEntry))
    for entry in diary_result.scalars().all():
        if entry.content and payload.source_id in entry.content:
            new_content = re.sub(
                r'@\[([^\]]+)\]\(' + re.escape(payload.source_id) + r'\)',
                f'@[{tgt.title}]({tgt.id})',
                entry.content
            )
            entry.content = new_content

    # Merge tags (union)
    merged_tags = list(set((tgt.tags or []) + (src.tags or [])))
    tgt.tags = merged_tags
    flag_modified(tgt, "tags")

    # Append source notes to target notes
    if src.notes and src.notes.strip():
        tgt.notes = (tgt.notes or "") + f"\n\n--- Merged from {src.title} ---\n{src.notes}"

    # Delete source
    await db.execute(delete(Mention).where(Mention.source_id == payload.source_id))
    await db.execute(delete(KnowledgeObject).where(KnowledgeObject.id == payload.source_id))
    tgt.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(tgt)
    return tgt


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
    obj_type = payload.type.upper().strip()
    if obj_type not in VALID_TYPES:
        raise HTTPException(400, f"Invalid type '{obj_type}'. Must be one of: {', '.join(sorted(VALID_TYPES))}")
    obj = KnowledgeObject(
        id=str(uuid.uuid4()),
        type=obj_type,
        title=payload.title,
        description=payload.description,
        notes=payload.notes,
        tags=list(payload.tags),
        properties=dict(payload.properties),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
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
        obj.tags = list(payload.tags)
        flag_modified(obj, "tags")
    if payload.properties is not None:
        obj.properties = dict(payload.properties)
        flag_modified(obj, "properties")
    obj.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(obj)
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


async def _sync_mentions(db: AsyncSession, obj: KnowledgeObject):
    await db.execute(
        delete(Mention).where(
            Mention.source_id == obj.id,
            Mention.source_type == "object"
        )
    )
    mentions = extract_mentions(obj.notes or "")
    for _name, target_id in mentions:
        if target_id == obj.id:
            continue
        db.add(Mention(
            id=str(uuid.uuid4()),
            object_id=target_id,
            source_type="object",
            source_id=obj.id,
        ))
    await db.commit()
