import asyncio
import uuid
from datetime import datetime, timedelta, date as date_cls

import httpx
import icalendar
import recurring_ical_events
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import Column, String, Boolean, DateTime, select, delete, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional, List

from database import get_db, engine, AsyncSessionLocal
from models.db_models import Base, User, KnowledgeObject
from auth import get_current_user
from utils.mentions import auto_tag_content

router = APIRouter(prefix="/api/calendar", tags=["calendar"])

SYNC_INTERVAL_SECONDS = 30 * 60          # poll every 30 minutes, per the feature request
SYNC_WINDOW_PAST_DAYS = 30               # how far back to pull events (recently-past context)
SYNC_WINDOW_FUTURE_DAYS = 180            # how far ahead to pull events
FETCH_TIMEOUT_SECONDS = 20

FEED_COLORS = ['#4285f4', '#ea4335', '#34a853', '#a374ff', '#ff8a5c', '#5ed6c4']

# ── DB Models ────────────────────────────────────────────────────────────────

class CalendarFeed(Base):
    __tablename__ = "calendar_feeds"
    id              = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id         = Column(String, nullable=True, index=True)
    name            = Column(String, nullable=False)
    url             = Column(String, nullable=False)
    color           = Column(String, nullable=False, default="#4285f4")
    last_synced_at  = Column(DateTime, nullable=True)
    last_error      = Column(String, nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow)

class CalendarEvent(Base):
    __tablename__ = "calendar_events"
    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id     = Column(String, nullable=True, index=True)
    feed_id     = Column(String, nullable=False, index=True)
    uid         = Column(String, nullable=False)     # ics UID + occurrence start, for dedup
    title       = Column(String, nullable=False, default="(untitled event)")
    location    = Column(String, nullable=True)
    description = Column(String, nullable=True)
    start_time  = Column(DateTime, nullable=False, index=True)
    end_time    = Column(DateTime, nullable=True)
    all_day     = Column(Boolean, default=False)
    created_at  = Column(DateTime, default=datetime.utcnow)

async def init_calendar_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

# ── Schemas ──────────────────────────────────────────────────────────────────

class FeedCreate(BaseModel):
    name: str
    url: str
    color: Optional[str] = None

def _feed_out(f: CalendarFeed) -> dict:
    return {
        "id": f.id, "name": f.name, "url": f.url, "color": f.color,
        "last_synced_at": f.last_synced_at.isoformat() + "Z" if f.last_synced_at else None,
        "last_error": f.last_error,
    }

def _to_naive_utc(dt) -> datetime:
    """icalendar gives back either a date, a naive datetime, or a tz-aware
    datetime depending on the feed — normalize everything to naive UTC for
    storage and comparison."""
    if isinstance(dt, datetime):
        if dt.tzinfo is not None:
            from datetime import timezone
            return dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    if isinstance(dt, date_cls):
        return datetime(dt.year, dt.month, dt.day)
    return dt

# ── Sync logic (shared by manual sync, auto-sync-on-add, and the background loop) ─

async def sync_feed(db: AsyncSession, feed: CalendarFeed) -> None:
    window_start = datetime.utcnow() - timedelta(days=SYNC_WINDOW_PAST_DAYS)
    window_end   = datetime.utcnow() + timedelta(days=SYNC_WINDOW_FUTURE_DAYS)

    try:
        async with httpx.AsyncClient(timeout=FETCH_TIMEOUT_SECONDS, follow_redirects=True) as client:
            resp = await client.get(feed.url)
            resp.raise_for_status()
            raw = resp.content
    except Exception as e:
        feed.last_error = f"Couldn't fetch calendar: {type(e).__name__}"
        await db.commit()
        return

    try:
        cal = icalendar.Calendar.from_ical(raw)
        occurrences = recurring_ical_events.of(cal).between(window_start, window_end)
    except Exception as e:
        feed.last_error = f"Couldn't parse calendar (is this a valid .ics URL?): {e}"
        await db.commit()
        return

    # Replace-within-window: this feed's data in the window is fully
    # superseded by what we just parsed, so cancellations/reschedules are
    # handled automatically without needing to diff old vs new.
    await db.execute(delete(CalendarEvent).where(
        CalendarEvent.feed_id == feed.id,
        CalendarEvent.start_time >= window_start,
        CalendarEvent.start_time <= window_end,
    ))

    for occ in occurrences:
        base_uid = str(occ.get('UID', str(uuid.uuid4())))
        dtstart_raw = occ.get('DTSTART')
        if not dtstart_raw:
            continue
        start_val = dtstart_raw.dt
        all_day = not isinstance(start_val, datetime)
        start_dt = _to_naive_utc(start_val)

        dtend_raw = occ.get('DTEND')
        end_dt = _to_naive_utc(dtend_raw.dt) if dtend_raw else None

        occurrence_uid = f"{base_uid}:{start_dt.isoformat()}"
        title = str(occ.get('SUMMARY', '(untitled event)'))
        location = str(occ.get('LOCATION')) if occ.get('LOCATION') else None
        description = str(occ.get('DESCRIPTION')) if occ.get('DESCRIPTION') else None

        db.add(CalendarEvent(
            id=str(uuid.uuid4()), user_id=feed.user_id, feed_id=feed.id,
            uid=occurrence_uid, title=title, location=location, description=description,
            start_time=start_dt, end_time=end_dt, all_day=all_day,
        ))

    feed.last_synced_at = datetime.utcnow()
    feed.last_error = None
    await db.commit()

# ── Background polling loop ─────────────────────────────────────────────────

async def calendar_sync_loop():
    """Runs for the lifetime of the app, re-syncing every feed for every
    user every SYNC_INTERVAL_SECONDS. Started once from the FastAPI
    lifespan — see main.py."""
    while True:
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(CalendarFeed))
                feeds = result.scalars().all()
                for feed in feeds:
                    await sync_feed(db, feed)
        except Exception:
            pass  # never let a bad feed / transient error kill the loop
        await asyncio.sleep(SYNC_INTERVAL_SECONDS)

# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/feeds")
async def list_feeds(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(CalendarFeed).where(CalendarFeed.user_id == current_user.id).order_by(CalendarFeed.created_at))
    return [_feed_out(f) for f in r.scalars().all()]


@router.post("/feeds", status_code=201)
async def create_feed(payload: FeedCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    url = payload.url.strip()
    if not url:
        raise HTTPException(400, "Feed URL required")
    # Google Calendar's "webcal://" links work fine over https — normalize.
    if url.startswith("webcal://"):
        url = "https://" + url[len("webcal://"):]

    count_r = await db.execute(select(CalendarFeed).where(CalendarFeed.user_id == current_user.id))
    count = len(count_r.scalars().all())
    if count >= 10:
        raise HTTPException(400, "Maximum of 10 calendar feeds allowed")

    color = payload.color or FEED_COLORS[count % len(FEED_COLORS)]
    feed = CalendarFeed(id=str(uuid.uuid4()), user_id=current_user.id, name=payload.name.strip() or "Calendar", url=url, color=color)
    db.add(feed)
    await db.commit()
    await db.refresh(feed)

    await sync_feed(db, feed)   # sync immediately so the user sees events right away
    await db.refresh(feed)
    return _feed_out(feed)


@router.post("/feeds/{feed_id}/sync")
async def sync_feed_now(feed_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(CalendarFeed).where(CalendarFeed.id == feed_id, CalendarFeed.user_id == current_user.id))
    feed = r.scalar_one_or_none()
    if not feed:
        raise HTTPException(404, "Feed not found")
    await sync_feed(db, feed)
    await db.refresh(feed)
    return _feed_out(feed)


@router.delete("/feeds/{feed_id}", status_code=204)
async def delete_feed(feed_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(CalendarFeed).where(CalendarFeed.id == feed_id, CalendarFeed.user_id == current_user.id))
    if not r.scalar_one_or_none():
        raise HTTPException(404, "Feed not found")
    await db.execute(delete(CalendarEvent).where(CalendarEvent.feed_id == feed_id, CalendarEvent.user_id == current_user.id))
    await db.execute(delete(CalendarFeed).where(CalendarFeed.id == feed_id, CalendarFeed.user_id == current_user.id))
    await db.commit()


@router.get("/events/{date}")
async def get_events_for_date(date: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Events overlapping the given YYYY-MM-DD, across all of this user's feeds."""
    try:
        day_start = datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD")
    day_end = day_start + timedelta(days=1)

    feeds_r = await db.execute(select(CalendarFeed).where(CalendarFeed.user_id == current_user.id))
    feed_colors = {f.id: {"name": f.name, "color": f.color} for f in feeds_r.scalars().all()}

    r = await db.execute(
        select(CalendarEvent).where(
            CalendarEvent.user_id == current_user.id,
            CalendarEvent.start_time < day_end,
            or_(
                and_(CalendarEvent.end_time == None, CalendarEvent.start_time >= day_start),
                and_(CalendarEvent.end_time != None, CalendarEvent.end_time > day_start),
            ),
        ).order_by(CalendarEvent.all_day.desc(), CalendarEvent.start_time)
    )
    events = r.scalars().all()

    # Auto-tag calendar text at read time (never persisted) — the sync loop
    # fully replaces event rows every 30 minutes from the source calendar,
    # so writing @[Name](id) into the stored title/description would just
    # get overwritten on the next sync. Computing it fresh on every read
    # avoids that entirely and always reflects your current objects.
    objs_result = await db.execute(select(KnowledgeObject).where(KnowledgeObject.user_id == current_user.id))
    objects = objs_result.scalars().all()

    out = []
    for e in events:
        title_tagged, _ = auto_tag_content(e.title, objects)
        desc_tagged = None
        if e.description:
            desc_tagged, _ = auto_tag_content(e.description, objects)
        out.append({
            "id": e.id, "title": e.title, "title_tagged": title_tagged,
            "description": e.description, "description_tagged": desc_tagged,
            "location": e.location,
            "start_time": e.start_time.isoformat() + "Z",
            "end_time": e.end_time.isoformat() + "Z" if e.end_time else None,
            "all_day": e.all_day,
            "feed_name": feed_colors.get(e.feed_id, {}).get("name", "Calendar"),
            "feed_color": feed_colors.get(e.feed_id, {}).get("color", "#4285f4"),
        })
    return out
