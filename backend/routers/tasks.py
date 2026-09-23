import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import Column, String, Boolean, DateTime, select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional

from database import get_db, engine
from models.db_models import Base, User, DiaryEntry
from auth import get_current_user

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

# ── DB Model ─────────────────────────────────────────────────────────────────

class Task(Base):
    __tablename__ = "tasks"
    id              = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id         = Column(String, nullable=True, index=True)
    title           = Column(String, nullable=False)
    done            = Column(Boolean, default=False)
    source_entry_id = Column(String, nullable=True)    # diary entry it was detected from, if any
    source_date     = Column(String, nullable=True)    # YYYY-MM-DD of that entry, for the hover link
    created_at      = Column(DateTime, default=datetime.utcnow)

async def init_task_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

# ── Schemas ──────────────────────────────────────────────────────────────────

class TaskCreate(BaseModel):
    title: str

class TaskUpdate(BaseModel):
    done: Optional[bool] = None
    title: Optional[str] = None

def _task_out(t: Task) -> dict:
    return {
        "id": t.id, "title": t.title, "done": t.done,
        "source_entry_id": t.source_entry_id, "source_date": t.source_date,
        "created_at": t.created_at.isoformat() + "Z",
    }

# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("")
async def list_tasks(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(Task).where(Task.user_id == current_user.id).order_by(Task.done, Task.created_at.desc()))
    return [_task_out(t) for t in r.scalars().all()]


@router.get("/active/{date}")
async def list_active_tasks(date: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Undone tasks to show on a Diary day view: anything not done, created
    on or before the viewed date — so an undone task keeps carrying forward
    on every day's view until it's checked off."""
    r = await db.execute(
        select(Task).where(Task.user_id == current_user.id, Task.done == False)
        .order_by(Task.created_at)
    )
    tasks = r.scalars().all()
    active = [t for t in tasks if t.created_at.strftime("%Y-%m-%d") <= date]
    return [_task_out(t) for t in active]


@router.post("", status_code=201)
async def create_task(payload: TaskCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    title = payload.title.strip()
    if not title:
        raise HTTPException(400, "Title required")
    task = Task(id=str(uuid.uuid4()), user_id=current_user.id, title=title)
    db.add(task)
    await db.commit()
    return _task_out(task)


@router.put("/{task_id}")
async def update_task(task_id: str, payload: TaskUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(Task).where(Task.id == task_id, Task.user_id == current_user.id))
    task = r.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found")
    if payload.done is not None:
        task.done = payload.done
    if payload.title is not None:
        task.title = payload.title.strip() or task.title
    await db.commit()
    return _task_out(task)


@router.delete("/{task_id}", status_code=204)
async def delete_task(task_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Task).where(Task.id == task_id, Task.user_id == current_user.id))
    await db.commit()
