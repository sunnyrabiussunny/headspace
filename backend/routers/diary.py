from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import List
from datetime import datetime
import uuid

from database import get_db
from models.db_models import DiaryEntry, Mention
from models.schemas import DiaryEntryCreate, DiaryEntryUpdate, DiaryEntryOut
from utils.mentions import extract_mentions

router = APIRouter(prefix="/api/diary", tags=["diary"])


@router.get("/dates", response_model=List[str])
async def get_all_dates(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DiaryEntry.date).distinct().order_by(DiaryEntry.date.desc())
    )
    return [row[0] for row in result.fetchall()]


@router.get("/date/{date}", response_model=List[DiaryEntryOut])
async def get_entries_for_date(date: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DiaryEntry)
        .where(DiaryEntry.date == date)
        .order_by(DiaryEntry.created_at.asc())
    )
    return result.scalars().all()


@router.get("/entry/{entry_id}", response_model=DiaryEntryOut)
async def get_entry_by_id(entry_id: str, db: AsyncSession = Depends(get_db)):
    """Fetch a single diary entry by its ID — used for backlink enrichment."""
    result = await db.execute(
        select(DiaryEntry).where(DiaryEntry.id == entry_id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Entry not found")
    return entry


@router.post("/", response_model=DiaryEntryOut, status_code=201)
async def create_entry(payload: DiaryEntryCreate, db: AsyncSession = Depends(get_db)):
    entry = DiaryEntry(
        id=str(uuid.uuid4()),
        date=payload.date,
        content=payload.content,
        tags=payload.tags,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    await _sync_mentions(db, entry)
    return entry


@router.put("/{entry_id}", response_model=DiaryEntryOut)
async def update_entry(
    entry_id: str, payload: DiaryEntryUpdate, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(DiaryEntry).where(DiaryEntry.id == entry_id))
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Entry not found")

    if payload.content is not None:
        entry.content = payload.content
    if payload.tags is not None:
        entry.tags = payload.tags
    entry.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(entry)
    await _sync_mentions(db, entry)
    return entry


@router.delete("/{entry_id}", status_code=204)
async def delete_entry(entry_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Mention).where(Mention.source_id == entry_id))
    await db.execute(delete(DiaryEntry).where(DiaryEntry.id == entry_id))
    await db.commit()


@router.get("/search/{query}", response_model=List[DiaryEntryOut])
async def search_diary(query: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DiaryEntry)
        .where(DiaryEntry.content.contains(query))
        .order_by(DiaryEntry.date.desc())
    )
    return result.scalars().all()


async def _sync_mentions(db: AsyncSession, entry: DiaryEntry):
    await db.execute(delete(Mention).where(Mention.source_id == entry.id))
    for _name, object_id in extract_mentions(entry.content):
        db.add(Mention(
            id=str(uuid.uuid4()),
            object_id=object_id,
            source_type="diary",
            source_id=entry.id,
        ))
    await db.commit()
