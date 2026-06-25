from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from database import get_db
from models.db_models import DiaryEntry, KnowledgeObject
from models.schemas import TagInfo, TagRename

router = APIRouter(prefix="/api/tags", tags=["tags"])


@router.get("", response_model=List[TagInfo])
async def list_all_tags(db: AsyncSession = Depends(get_db)):
    tag_diary: dict[str, int] = {}
    tag_obj:   dict[str, int] = {}

    for entry in (await db.execute(select(DiaryEntry))).scalars().all():
        for t in (entry.tags or []):
            tag_diary[t] = tag_diary.get(t, 0) + 1

    for obj in (await db.execute(select(KnowledgeObject))).scalars().all():
        for t in (obj.tags or []):
            tag_obj[t] = tag_obj.get(t, 0) + 1

    all_tags = set(tag_diary) | set(tag_obj)
    return [
        TagInfo(name=n, diary_count=tag_diary.get(n,0), object_count=tag_obj.get(n,0),
                total=tag_diary.get(n,0)+tag_obj.get(n,0))
        for n in sorted(all_tags)
    ]


@router.put("/rename")
async def rename_tag(payload: TagRename, db: AsyncSession = Depends(get_db)):
    old, new = payload.old_name.strip(), payload.new_name.strip()
    if not old or not new:
        raise HTTPException(400, "Tag names must not be empty")

    updated_entries = 0
    for entry in (await db.execute(select(DiaryEntry))).scalars().all():
        if old in (entry.tags or []):
            entry.tags = [new if t == old else t for t in entry.tags]
            updated_entries += 1

    updated_objects = 0
    for obj in (await db.execute(select(KnowledgeObject))).scalars().all():
        if old in (obj.tags or []):
            obj.tags = [new if t == old else t for t in obj.tags]
            updated_objects += 1

    await db.commit()
    return {"status": "ok", "updated_entries": updated_entries, "updated_objects": updated_objects}


@router.delete("/{tag_name}")
async def delete_tag(tag_name: str, db: AsyncSession = Depends(get_db)):
    for entry in (await db.execute(select(DiaryEntry))).scalars().all():
        if tag_name in (entry.tags or []):
            entry.tags = [t for t in entry.tags if t != tag_name]

    for obj in (await db.execute(select(KnowledgeObject))).scalars().all():
        if tag_name in (obj.tags or []):
            obj.tags = [t for t in obj.tags if t != tag_name]

    await db.commit()
    return {"status": "ok"}


@router.get("/search")
async def search_tags(q: str = "", db: AsyncSession = Depends(get_db)):
    """Return tags whose name starts with or contains q."""
    result = await list_all_tags(db)
    q = q.lower().strip().lstrip('#')
    if not q:
        return result
    return [t for t in result if q in t.name.lower()]
