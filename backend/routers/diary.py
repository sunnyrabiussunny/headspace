from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
import uuid

from database import get_db
from models.db_models import DiaryEntry, Mention, User
from models.schemas import DiaryEntryCreate, DiaryEntryUpdate, DiaryEntryOut
from utils.mentions import extract_mentions, auto_tag_content
from utils.mentions import strip_mentions
from utils.ollama_client import retrieve_relevant_entries, ask_ollama
from auth import get_current_user

router = APIRouter(prefix="/api/diary", tags=["diary"])


@router.get("/dates", response_model=List[str])
async def get_all_dates(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DiaryEntry.date).where(DiaryEntry.user_id == current_user.id).distinct().order_by(DiaryEntry.date.desc())
    )
    return [row[0] for row in result.fetchall()]


@router.get("/all", response_model=List[DiaryEntryOut])
async def get_all_entries(tag: Optional[str] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Get all diary entries sorted by date desc, optionally filtered by tag."""
    q = select(DiaryEntry).where(DiaryEntry.user_id == current_user.id).order_by(DiaryEntry.date.desc(), DiaryEntry.created_at.asc())
    result = await db.execute(q)
    entries = result.scalars().all()
    if tag:
        entries = [e for e in entries if tag in (e.tags or [])]
    return entries


@router.get("/date/{date}", response_model=List[DiaryEntryOut])
async def get_entries_for_date(date: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DiaryEntry)
        .where(DiaryEntry.date == date, DiaryEntry.user_id == current_user.id)
        .order_by(DiaryEntry.created_at.asc())
    )
    return result.scalars().all()


@router.get("/entry/{entry_id}", response_model=DiaryEntryOut)
async def get_entry_by_id(entry_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DiaryEntry).where(DiaryEntry.id == entry_id, DiaryEntry.user_id == current_user.id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Entry not found")
    return entry


@router.post("/", response_model=DiaryEntryOut, status_code=201)
async def create_entry(payload: DiaryEntryCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    entry = DiaryEntry(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        date=payload.date,
        content=payload.content,
        tags=list(payload.tags),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    await _sync_mentions(db, entry, current_user.id)
    return entry


@router.put("/{entry_id}", response_model=DiaryEntryOut)
async def update_entry(
    entry_id: str, payload: DiaryEntryUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(DiaryEntry).where(DiaryEntry.id == entry_id, DiaryEntry.user_id == current_user.id))
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
            date_part = raw[:10]
            if len(date_part) == 10 and date_part[4] == "-" and date_part[7] == "-":
                entry.date = date_part
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
    await _sync_mentions(db, entry, current_user.id)
    return entry


@router.delete("/{entry_id}", status_code=204)
async def delete_entry(entry_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Mention).where(Mention.source_id == entry_id, Mention.user_id == current_user.id))
    await db.execute(delete(DiaryEntry).where(DiaryEntry.id == entry_id, DiaryEntry.user_id == current_user.id))
    await db.commit()


class AskRequest(BaseModel):
    question: str


@router.post("/ask")
async def ask_diary(payload: AskRequest, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """'Ask Your Diary' — retrieves relevant entries (keyword overlap +
    recency, no vector DB needed at this scale) and asks the local Ollama
    model to answer using only those excerpts."""
    question = payload.question.strip()
    if not question:
        raise HTTPException(400, "Question required")

    result = await db.execute(select(DiaryEntry).where(DiaryEntry.user_id == current_user.id))
    entries = result.scalars().all()
    if not entries:
        return {"answer": "You don't have any diary entries yet — nothing to search.", "sources": []}

    top_entries = retrieve_relevant_entries(question, entries, top_n=12)
    context = [(e.date, strip_mentions(e.content or "")) for e in top_entries]

    answer = await ask_ollama(question, context)

    return {
        "answer": answer,
        "sources": [{"id": e.id, "date": e.date, "snippet": strip_mentions(e.content or "")[:140]} for e in top_entries],
    }


@router.get("/on-this-day/{date}")
async def on_this_day(date: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Return entries from the same month/day in previous years (multi-year diary recall)."""
    try:
        month_day = date[5:10]   # "MM-DD"
    except Exception:
        raise HTTPException(400, "date must be YYYY-MM-DD")

    result = await db.execute(
        select(DiaryEntry)
        .where(DiaryEntry.user_id == current_user.id, DiaryEntry.date.like(f"%-{month_day}"))
        .order_by(DiaryEntry.date.desc())
    )
    entries = [e for e in result.scalars().all() if e.date != date]
    return [{
        "id": e.id, "date": e.date, "year": e.date[:4],
        "years_ago": int(date[:4]) - int(e.date[:4]),
        "content": e.content, "tags": e.tags or [],
    } for e in entries]


@router.get("/search/{query}", response_model=List[DiaryEntryOut])
async def search_diary(query: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DiaryEntry)
        .where(DiaryEntry.content.contains(query), DiaryEntry.user_id == current_user.id)
        .order_by(DiaryEntry.date.desc())
    )
    return result.scalars().all()


@router.post("/{entry_id}/auto-tag", response_model=DiaryEntryOut)
async def auto_tag_entry(entry_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Scan the entry for plain-text mentions of existing objects and link
    them. Never creates new objects — only tags names that already exist."""
    from models.db_models import KnowledgeObject
    result = await db.execute(select(DiaryEntry).where(DiaryEntry.id == entry_id, DiaryEntry.user_id == current_user.id))
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Entry not found")

    objs_result = await db.execute(select(KnowledgeObject).where(KnowledgeObject.user_id == current_user.id))
    objects = objs_result.scalars().all()

    new_content, count = auto_tag_content(entry.content, objects)
    entry.content = new_content
    entry.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(entry)
    await _sync_mentions(db, entry, current_user.id)
    return entry


async def _sync_mentions(db: AsyncSession, entry: DiaryEntry, user_id: str):
    await db.execute(delete(Mention).where(Mention.source_id == entry.id, Mention.user_id == user_id))
    for _name, object_id in extract_mentions(entry.content):
        db.add(Mention(
            id=str(uuid.uuid4()),
            user_id=user_id,
            object_id=object_id,
            source_type="diary",
            source_id=entry.id,
        ))
    await db.commit()


@router.get("/entry/{entry_id}/context")
async def get_entry_context(entry_id: str, object_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DiaryEntry).where(DiaryEntry.id == entry_id, DiaryEntry.user_id == current_user.id))
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
