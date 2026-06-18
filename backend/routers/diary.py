from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import List, Optional
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


@router.get("/all", response_model=List[DiaryEntryOut])
async def get_all_entries(tag: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    """Get all diary entries sorted by date desc, optionally filtered by tag."""
    q = select(DiaryEntry).order_by(DiaryEntry.date.desc(), DiaryEntry.created_at.asc())
    result = await db.execute(q)
    entries = result.scalars().all()
    if tag:
        entries = [e for e in entries if tag in (e.tags or [])]
    return entries


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
        tags=list(payload.tags),
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
        entry.tags = list(payload.tags)

    if payload.created_at is not None:
        try:
            raw = payload.created_at
            # Extract YYYY-MM-DD from the local datetime string the frontend sends
            # e.g. "2024-06-15T09:30:00.000Z" or "2024-06-15T12:30"
            # The date part always reflects what the user picked in their local time
            date_part = raw[:10]
            if len(date_part) == 10 and date_part[4] == "-" and date_part[7] == "-":
                entry.date = date_part
            # Parse to UTC for storage
            ts = raw.replace("Z", "+00:00")
            parsed = datetime.fromisoformat(ts)
            if parsed.tzinfo is not None:
                from datetime import timezone as _tz
                parsed = parsed.astimezone(_tz.utc).replace(tzinfo=None)
            entry.created_at = parsed
        except Exception:
            pass  # ignore malformed timestamps

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


@router.get("/entry/{entry_id}/context")
async def get_entry_context(entry_id: str, object_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DiaryEntry).where(DiaryEntry.id == entry_id))
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Entry not found")

    snippet = _extract_context(entry.content, object_id)
    return {
        "id": entry.id,
        "date": entry.date,
        "snippet": snippet,
    }


def _extract_context(content: str, object_id: str) -> str:
    import re
    pattern = re.compile(r'@\[([^\]]+)\]\(' + re.escape(object_id) + r'\)')
    m = pattern.search(content)
    if not m:
        plain = re.sub(r'@\[([^\]]+)\]\([^)]+\)', r'@\1', content)
        return plain.strip()[:80]

    name = m.group(1)
    start = m.start()
    end   = m.end()

    before_raw = re.sub(r'@\[([^\]]+)\]\([^)]+\)', r'@\1', content[:start]).strip()
    after_raw  = re.sub(r'@\[([^\]]+)\]\([^)]+\)', r'@\1', content[end:]).strip()

    before_words = before_raw.split()[-5:] if before_raw else []
    after_words  = after_raw.split()[:5]  if after_raw  else []

    parts = []
    if before_words:
        parts.append(' '.join(before_words))
    parts.append(f'@{name}')
    if after_words:
        parts.append(' '.join(after_words))

    snippet = ' '.join(parts)
    if before_words:
        snippet = '...' + snippet
    if after_words:
        snippet = snippet + '...'
    return snippet
