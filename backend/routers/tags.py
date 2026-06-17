from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified
from typing import List

from database import get_db
from models.db_models import DiaryEntry, KnowledgeObject
from models.schemas import TagInfo, TagRename

router = APIRouter(prefix="/api/tags", tags=["tags"])


@router.get("", response_model=List[TagInfo])
async def list_all_tags(db: AsyncSession = Depends(get_db)):
    """Return all tags used across diary entries and objects with counts."""
    tag_diary: dict[str, int] = {}
    tag_obj: dict[str, int] = {}

    diary_result = await db.execute(select(DiaryEntry))
    for entry in diary_result.scalars().all():
        for t in (entry.tags or []):
            tag_diary[t] = tag_diary.get(t, 0) + 1

    obj_result = await db.execute(select(KnowledgeObject))
    for obj in obj_result.scalars().all():
        for t in (obj.tags or []):
            tag_obj[t] = tag_obj.get(t, 0) + 1

    all_tags = set(tag_diary.keys()) | set(tag_obj.keys())
    result = []
    for name in sorted(all_tags):
        d = tag_diary.get(name, 0)
        o = tag_obj.get(name, 0)
        result.append(TagInfo(name=name, diary_count=d, object_count=o, total=d + o))
    return result


@router.put("/rename")
async def rename_tag(payload: TagRename, db: AsyncSession = Depends(get_db)):
    """Rename a tag globally across all diary entries and objects."""
    old, new = payload.old_name.strip(), payload.new_name.strip()
    if not old or not new:
        raise HTTPException(400, "Tag names must not be empty")

    diary_result = await db.execute(select(DiaryEntry))
    updated_entries = 0
    for entry in diary_result.scalars().all():
        if old in (entry.tags or []):
            entry.tags = [new if t == old else t for t in entry.tags]
            flag_modified(entry, "tags")
            updated_entries += 1

    obj_result = await db.execute(select(KnowledgeObject))
    updated_objects = 0
    for obj in obj_result.scalars().all():
        if old in (obj.tags or []):
            obj.tags = [new if t == old else t for t in obj.tags]
            flag_modified(obj, "tags")
            updated_objects += 1

    await db.commit()
    return {"status": "ok", "updated_entries": updated_entries, "updated_objects": updated_objects}


@router.delete("/{tag_name}")
async def delete_tag(tag_name: str, db: AsyncSession = Depends(get_db)):
    """Remove a tag globally from all diary entries and objects."""
    diary_result = await db.execute(select(DiaryEntry))
    for entry in diary_result.scalars().all():
        if tag_name in (entry.tags or []):
            entry.tags = [t for t in entry.tags if t != tag_name]
            flag_modified(entry, "tags")

    obj_result = await db.execute(select(KnowledgeObject))
    for obj in obj_result.scalars().all():
        if tag_name in (obj.tags or []):
            obj.tags = [t for t in obj.tags if t != tag_name]
            flag_modified(obj, "tags")

    await db.commit()
    return {"status": "ok"}
