from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import Column, String, Integer, Boolean, DateTime, select, delete
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, date
import uuid

from database import get_db, engine
from models.db_models import Base, User   # same Base as rest of app
from auth import get_current_user

router = APIRouter(prefix="/api/habits", tags=["habits"])

# ── DB Models ─────────────────────────────────────────────────────────────────

class Habit(Base):
    __tablename__ = "habits"
    id         = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id    = Column(String, nullable=True, index=True)
    title      = Column(String, nullable=False)
    icon       = Column(String, nullable=False, default="✅")
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

class HabitCompletion(Base):
    __tablename__ = "habit_completions"
    id         = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id    = Column(String, nullable=True, index=True)
    habit_id   = Column(String, nullable=False, index=True)
    date       = Column(String, nullable=False, index=True)  # YYYY-MM-DD
    created_at = Column(DateTime, default=datetime.utcnow)

# ── Startup ───────────────────────────────────────────────────────────────────

async def init_habit_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def seed_default_habits(db: AsyncSession, user_id: str):
    """Seed the 9 default habits for a brand-new user, only if they have none yet."""
    existing = await db.execute(select(Habit).where(Habit.user_id == user_id))
    if existing.scalars().first():
        return
    defaults = [
        ("Call F&F", "🤝"),
        ("Read",     "📖"),
        ("Water 2L", "💧"),
        ("Fazr",     "🌅"),
        ("Duhr",     "☀️"),
        ("Asr",      "🌤"),
        ("Maghrib",  "🌇"),
        ("Isha",     "🌙"),
        ("Exercise", "🏃"),
    ]
    for i, (title, icon) in enumerate(defaults):
        db.add(Habit(id=str(uuid.uuid4()), user_id=user_id, title=title, icon=icon, sort_order=i))
    await db.commit()

# ── Schemas ──────────────────────────────────────────────────────────────────

class HabitCreate(BaseModel):
    title: str
    icon: str = "✅"

class HabitUpdate(BaseModel):
    title: Optional[str] = None
    icon:  Optional[str] = None

# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("")
async def list_habits(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await seed_default_habits(db, current_user.id)
    r = await db.execute(
        select(Habit).where(Habit.user_id == current_user.id).order_by(Habit.sort_order, Habit.created_at)
    )
    habits = r.scalars().all()
    return [{"id": h.id, "title": h.title, "icon": h.icon, "sort_order": h.sort_order} for h in habits]


@router.post("", status_code=201)
async def create_habit(payload: HabitCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    count_r = await db.execute(select(Habit).where(Habit.user_id == current_user.id))
    count = len(count_r.scalars().all())
    if count >= 15:
        raise HTTPException(400, "Maximum of 15 habits allowed")
    habit = Habit(id=str(uuid.uuid4()), user_id=current_user.id,
                   title=payload.title.strip() or "Untitled", icon=payload.icon or "✅",
                   sort_order=count)
    db.add(habit); await db.commit(); await db.refresh(habit)
    return {"id": habit.id, "title": habit.title, "icon": habit.icon, "sort_order": habit.sort_order}


@router.put("/{habit_id}")
async def update_habit(habit_id: str, payload: HabitUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(Habit).where(Habit.id == habit_id, Habit.user_id == current_user.id))
    habit = r.scalar_one_or_none()
    if not habit: raise HTTPException(404, "Habit not found")
    if payload.title is not None: habit.title = payload.title.strip() or habit.title
    if payload.icon  is not None: habit.icon  = payload.icon
    await db.commit(); await db.refresh(habit)
    return {"id": habit.id, "title": habit.title, "icon": habit.icon, "sort_order": habit.sort_order}


@router.delete("/{habit_id}", status_code=204)
async def delete_habit(habit_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(HabitCompletion).where(HabitCompletion.habit_id == habit_id, HabitCompletion.user_id == current_user.id))
    await db.execute(delete(Habit).where(Habit.id == habit_id, Habit.user_id == current_user.id))
    await db.commit()


@router.get("/completions/{for_date}")
async def get_completions(for_date: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Completion status for a single date, plus each habit's last-completed date (for the streak dot)."""
    r = await db.execute(select(HabitCompletion.habit_id).where(
        HabitCompletion.user_id == current_user.id, HabitCompletion.date == for_date
    ))
    done_today = {row[0] for row in r.all()}

    all_r = await db.execute(select(HabitCompletion).where(HabitCompletion.user_id == current_user.id))
    last_done = {}
    for c in all_r.scalars().all():
        if c.habit_id not in last_done or c.date > last_done[c.habit_id]:
            last_done[c.habit_id] = c.date

    return {"date": for_date, "done": list(done_today), "last_done": last_done}


class ToggleRequest(BaseModel):
    habit_id: str
    date: str

@router.post("/toggle")
async def toggle_completion(payload: ToggleRequest, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(HabitCompletion).where(
        HabitCompletion.habit_id == payload.habit_id, HabitCompletion.date == payload.date, HabitCompletion.user_id == current_user.id
    ))
    existing = r.scalar_one_or_none()
    if existing:
        await db.delete(existing); await db.commit()
        return {"done": False}
    db.add(HabitCompletion(id=str(uuid.uuid4()), user_id=current_user.id, habit_id=payload.habit_id, date=payload.date))
    await db.commit()
    return {"done": True}
