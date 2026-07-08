from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import Column, String, Integer, Boolean, DateTime, Date, select, delete
from sqlalchemy.ext.declarative import declarative_base
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, date, timedelta
import uuid

from database import get_db, engine
from models.db_models import Base

router = APIRouter(prefix="/api/habits", tags=["habits"])

# ── Models ───────────────────────────────────────────────────────────────────

class Habit(Base):
    __tablename__ = "habits"
    id         = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    title      = Column(String, nullable=False)
    icon       = Column(String, default="✓")
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

class HabitCompletion(Base):
    __tablename__ = "habit_completions"
    id         = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    habit_id   = Column(String, nullable=False, index=True)
    date       = Column(String, nullable=False, index=True)   # YYYY-MM-DD
    completed  = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

async def init_habit_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Seed defaults if no habits exist
    async with AsyncSession(engine) as db:
        result = await db.execute(select(Habit))
        if not result.scalars().first():
            defaults = [
                ("Contact F&Fs", "🤝"), ("Read a book", "📖"),
                ("2 liters of water", "💧"), ("Fazr", "🌅"),
                ("Duhr", "☀️"), ("Asr", "🌤"), ("Maghrib", "🌇"),
                ("Isha", "🌙"), ("Exercise", "🏃"),
            ]
            for i, (title, icon) in enumerate(defaults):
                db.add(Habit(id=str(uuid.uuid4()), title=title, icon=icon, sort_order=i))
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

async def _last_completion(db: AsyncSession, habit_id: str) -> Optional[str]:
    """Return the most recent completion date for a habit, or None."""
    result = await db.execute(
        select(HabitCompletion.date)
        .where(HabitCompletion.habit_id == habit_id)
        .where(HabitCompletion.completed == True)
        .order_by(HabitCompletion.date.desc())
        .limit(1)
    )
    row = result.scalar_one_or_none()
    return row

def _health_color(last_date: Optional[str]) -> str:
    """Green/yellow/red based on days since last completion."""
    if not last_date:
        return "red"
    try:
        delta = (date.today() - date.fromisoformat(last_date)).days
    except Exception:
        return "red"
    if delta <= 1:
        return "green"
    if delta <= 7:
        return "yellow"
    return "red"

# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("")
async def list_habits(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Habit).order_by(Habit.sort_order, Habit.created_at))
    habits = result.scalars().all()
    out = []
    for h in habits:
        last = await _last_completion(db, h.id)
        out.append({
            "id": h.id, "title": h.title, "icon": h.icon,
            "sort_order": h.sort_order,
            "health": _health_color(last),
            "last_completed": last,
        })
    return out

@router.get("/completions/{date_str}")
async def get_completions(date_str: str, db: AsyncSession = Depends(get_db)):
    """Return set of completed habit IDs for a given date."""
    result = await db.execute(
        select(HabitCompletion.habit_id)
        .where(HabitCompletion.date == date_str)
        .where(HabitCompletion.completed == True)
    )
    return {"date": date_str, "completed": [r[0] for r in result.fetchall()]}

@router.post("/toggle")
async def toggle_completion(body: dict, db: AsyncSession = Depends(get_db)):
    """Toggle a habit's completion for a date."""
    habit_id = body.get("habit_id")
    date_str = body.get("date")
    if not habit_id or not date_str:
        raise HTTPException(400, "habit_id and date required")

    result = await db.execute(
        select(HabitCompletion)
        .where(HabitCompletion.habit_id == habit_id)
        .where(HabitCompletion.date == date_str)
    )
    existing = result.scalar_one_or_none()

    if existing:
        existing.completed = not existing.completed
        now_completed = existing.completed
    else:
        db.add(HabitCompletion(
            id=str(uuid.uuid4()),
            habit_id=habit_id, date=date_str, completed=True
        ))
        now_completed = True

    await db.commit()
    return {"habit_id": habit_id, "date": date_str, "completed": now_completed}

@router.post("")
async def create_habit(payload: HabitCreate, db: AsyncSession = Depends(get_db)):
    count = len((await db.execute(select(Habit))).scalars().all())
    if count >= 15:
        raise HTTPException(400, "Maximum 15 habits allowed")
    h = Habit(id=str(uuid.uuid4()), title=payload.title.strip(),
              icon=payload.icon, sort_order=payload.sort_order or count)
    db.add(h); await db.commit(); await db.refresh(h)
    return {"id": h.id, "title": h.title, "icon": h.icon, "sort_order": h.sort_order, "health": "green", "last_completed": None}

@router.put("/{habit_id}")
async def update_habit(habit_id: str, payload: HabitUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Habit).where(Habit.id == habit_id))
    h = result.scalar_one_or_none()
    if not h: raise HTTPException(404)
    if payload.title is not None: h.title = payload.title.strip()
    if payload.icon  is not None: h.icon  = payload.icon
    if payload.sort_order is not None: h.sort_order = payload.sort_order
    await db.commit(); await db.refresh(h)
    last = await _last_completion(db, h.id)
    return {"id": h.id, "title": h.title, "icon": h.icon, "sort_order": h.sort_order,
            "health": _health_color(last), "last_completed": last}

@router.delete("/{habit_id}", status_code=204)
async def delete_habit(habit_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(HabitCompletion).where(HabitCompletion.habit_id == habit_id))
    await db.execute(delete(Habit).where(Habit.id == habit_id))
    await db.commit()
