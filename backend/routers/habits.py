from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy import Column, String, Integer, Boolean, DateTime, select, delete, text
from sqlalchemy.orm import DeclarativeBase
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, date
import uuid

from database import get_db, engine

router = APIRouter(prefix="/api/habits", tags=["habits"])

# ── Separate base for habit tables ──────────────────────────────────────────

class HabitBase(DeclarativeBase):
    pass

class Habit(HabitBase):
    __tablename__ = "habits"
    id         = Column(String, primary_key=True)
    title      = Column(String, nullable=False)
    icon       = Column(String, default="✓")
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

class HabitCompletion(HabitBase):
    __tablename__ = "habit_completions"
    id         = Column(String, primary_key=True)
    habit_id   = Column(String, nullable=False, index=True)
    date       = Column(String, nullable=False, index=True)
    completed  = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

# ── Startup: create tables + seed defaults ───────────────────────────────────

DEFAULTS = [
    ("Contact F&Fs", "🤝"), ("Read a book", "📖"),
    ("2 liters of water", "💧"), ("Fazr", "🌅"),
    ("Duhr", "☀️"), ("Asr", "🌤"), ("Maghrib", "🌇"),
    ("Isha", "🌙"), ("Exercise", "🏃"),
]

async def init_habit_tables():
    async with engine.begin() as conn:
        await conn.run_sync(HabitBase.metadata.create_all)

    # Seed if empty
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as db:
        result = await db.execute(select(Habit).limit(1))
        if not result.scalar_one_or_none():
            for i, (title, icon) in enumerate(DEFAULTS):
                db.add(Habit(
                    id=str(uuid.uuid4()), title=title,
                    icon=icon, sort_order=i
                ))
            await db.commit()

# ── Schemas ──────────────────────────────────────────────────────────────────

class HabitCreate(BaseModel):
    title: str
    icon: str = "✓"
    sort_order: int = 0

class HabitUpdate(BaseModel):
    title: Optional[str] = None
    icon: Optional[str] = None
    sort_order: Optional[int] = None

# ── Helpers ──────────────────────────────────────────────────────────────────

async def _last_completion_date(db: AsyncSession, habit_id: str) -> Optional[str]:
    r = await db.execute(
        select(HabitCompletion.date)
        .where(HabitCompletion.habit_id == habit_id)
        .where(HabitCompletion.completed == True)
        .order_by(HabitCompletion.date.desc())
        .limit(1)
    )
    return r.scalar_one_or_none()

def _health(last: Optional[str]) -> str:
    if not last:
        return "red"
    try:
        delta = (date.today() - date.fromisoformat(last)).days
    except Exception:
        return "red"
    if delta <= 1:  return "green"
    if delta <= 7:  return "yellow"
    return "red"

async def _habit_out(db: AsyncSession, h: Habit) -> dict:
    last = await _last_completion_date(db, h.id)
    return {
        "id": h.id, "title": h.title, "icon": h.icon,
        "sort_order": h.sort_order,
        "health": _health(last),
        "last_completed": last,
    }

# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
async def list_habits(db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(Habit).order_by(Habit.sort_order, Habit.created_at))
    return [await _habit_out(db, h) for h in r.scalars().all()]

@router.get("/completions/{date_str}")
async def get_completions(date_str: str, db: AsyncSession = Depends(get_db)):
    r = await db.execute(
        select(HabitCompletion.habit_id)
        .where(HabitCompletion.date == date_str)
        .where(HabitCompletion.completed == True)
    )
    return {"date": date_str, "completed": [row[0] for row in r.fetchall()]}

@router.post("/toggle")
async def toggle(body: dict, db: AsyncSession = Depends(get_db)):
    habit_id = body.get("habit_id")
    date_str  = body.get("date")
    if not habit_id or not date_str:
        raise HTTPException(400, "habit_id and date required")

    r = await db.execute(
        select(HabitCompletion)
        .where(HabitCompletion.habit_id == habit_id)
        .where(HabitCompletion.date == date_str)
    )
    existing = r.scalar_one_or_none()
    if existing:
        existing.completed = not existing.completed
        now = existing.completed
    else:
        db.add(HabitCompletion(
            id=str(uuid.uuid4()),
            habit_id=habit_id, date=date_str, completed=True
        ))
        now = True
    await db.commit()
    return {"habit_id": habit_id, "date": date_str, "completed": now}

@router.post("")
async def create_habit(payload: HabitCreate, db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(Habit))
    if len(r.scalars().all()) >= 15:
        raise HTTPException(400, "Maximum 15 habits")
    h = Habit(
        id=str(uuid.uuid4()), title=payload.title.strip(),
        icon=payload.icon, sort_order=payload.sort_order
    )
    db.add(h); await db.commit(); await db.refresh(h)
    return await _habit_out(db, h)

@router.put("/{habit_id}")
async def update_habit(habit_id: str, payload: HabitUpdate,
                       db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(Habit).where(Habit.id == habit_id))
    h = r.scalar_one_or_none()
    if not h: raise HTTPException(404)
    if payload.title is not None:      h.title      = payload.title.strip()
    if payload.icon  is not None:      h.icon       = payload.icon
    if payload.sort_order is not None: h.sort_order = payload.sort_order
    await db.commit(); await db.refresh(h)
    return await _habit_out(db, h)

@router.delete("/{habit_id}", status_code=204)
async def delete_habit(habit_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(HabitCompletion).where(HabitCompletion.habit_id == habit_id))
    await db.execute(delete(Habit).where(Habit.id == habit_id))
    await db.commit()
