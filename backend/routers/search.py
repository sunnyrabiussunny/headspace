from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from typing import List

from database import get_db
from models.db_models import DiaryEntry, KnowledgeObject
from models.schemas import SearchResult
from utils.mentions import strip_mentions

router = APIRouter(prefix="/api/search", tags=["search"])

OBJECT_EMOJI = {
    "PERSON": "person",
    "PLACE": "place",
    "IDEA": "idea",
    "ORGANIZATION": "org",
}


@router.get("/{query}", response_model=List[SearchResult])
async def global_search(query: str, db: AsyncSession = Depends(get_db)):
    results: List[SearchResult] = []

    # Diary entries
    diary_res = await db.execute(
        select(DiaryEntry)
        .where(DiaryEntry.content.contains(query))
        .order_by(DiaryEntry.date.desc())
        .limit(10)
    )
    for entry in diary_res.scalars().all():
        results.append(SearchResult(
            id=entry.id,
            type="diary",
            title=entry.date,
            preview=strip_mentions(entry.content)[:140],
            date=entry.date,
        ))

    # Objects
    obj_res = await db.execute(
        select(KnowledgeObject).where(
            or_(
                KnowledgeObject.title.ilike(f"%{query}%"),
                KnowledgeObject.description.ilike(f"%{query}%"),
                KnowledgeObject.notes.ilike(f"%{query}%"),
            )
        ).order_by(KnowledgeObject.updated_at.desc()).limit(10)
    )
    for obj in obj_res.scalars().all():
        results.append(SearchResult(
            id=obj.id,
            type="object",
            title=obj.title,
            preview=obj.description[:140] or obj.notes[:140],
            object_type=obj.type,
        ))

    return results
