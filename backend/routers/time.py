from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import Column, String, Text, DateTime, Float, Boolean, Integer, select, delete, func
from sqlalchemy.ext.declarative import declarative_base
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta, date
import uuid, csv, io, json

from database import get_db, engine
from models.db_models import Base

router = APIRouter(prefix="/api/time", tags=["time"])

# ── Models ─────────────────────────────────────────────────────────────────

class TimeProject(Base):
    __tablename__ = "time_projects"
    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name        = Column(String, nullable=False)
    color       = Column(String, default="#3dbfa0")
    client      = Column(String, default="")
    archived    = Column(Boolean, default=False)
    created_at  = Column(DateTime, default=datetime.utcnow)

class TimeTask(Base):
    __tablename__ = "time_tasks"
    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id  = Column(String, nullable=False)
    name        = Column(String, nullable=False)
    created_at  = Column(DateTime, default=datetime.utcnow)

class TimeEntry(Base):
    __tablename__ = "time_entries"
    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id  = Column(String, nullable=False)
    task_id     = Column(String, default="")
    description = Column(Text, default="")
    tags        = Column(Text, default="[]")   # JSON array stored as text
    start_time  = Column(DateTime, nullable=False)
    end_time    = Column(DateTime, nullable=True)   # NULL = running
    duration    = Column(Float, default=0)          # seconds
    created_at  = Column(DateTime, default=datetime.utcnow)

# ── Schemas ─────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str
    color: str = "#3dbfa0"
    client: str = ""

class ProjectOut(BaseModel):
    id: str; name: str; color: str; client: str; archived: bool; created_at: datetime
    class Config: from_attributes = True

class TaskCreate(BaseModel):
    project_id: str
    name: str

class TaskOut(BaseModel):
    id: str; project_id: str; name: str; created_at: datetime
    class Config: from_attributes = True

class EntryCreate(BaseModel):
    project_id: str
    task_id: str = ""
    description: str = ""
    tags: List[str] = []
    start_time: Optional[str] = None   # ISO string; None = now

class EntryUpdate(BaseModel):
    project_id: Optional[str] = None
    task_id: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None

class EntryOut(BaseModel):
    id: str; project_id: str; task_id: str; description: str
    tags: List[str]; start_time: datetime; end_time: Optional[datetime]
    duration: float; created_at: datetime
    class Config: from_attributes = True

# ── Startup ─────────────────────────────────────────────────────────────────

async def init_time_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

# ── Helpers ─────────────────────────────────────────────────────────────────

def _parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)

def _tags_to_list(raw: str) -> List[str]:
    try: return json.loads(raw or "[]")
    except: return []

def _entry_out(e: TimeEntry) -> dict:
    return {
        "id": e.id, "project_id": e.project_id, "task_id": e.task_id or "",
        "description": e.description or "", "tags": _tags_to_list(e.tags),
        "start_time": e.start_time.isoformat() + "Z" if e.start_time else None,
        "end_time":   e.end_time.isoformat()   + "Z" if e.end_time   else None,
        "duration": e.duration or 0,
        "created_at": e.created_at.isoformat() + "Z",
    }

# ── Projects ─────────────────────────────────────────────────────────────────

@router.get("/projects")
async def list_projects(db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(TimeProject).where(TimeProject.archived == False).order_by(TimeProject.created_at))
    return [{"id":p.id,"name":p.name,"color":p.color,"client":p.client,"archived":p.archived,"created_at":p.created_at.isoformat()+"Z"} for p in r.scalars().all()]

@router.post("/projects", status_code=201)
async def create_project(payload: ProjectCreate, db: AsyncSession = Depends(get_db)):
    p = TimeProject(id=str(uuid.uuid4()), name=payload.name, color=payload.color, client=payload.client)
    db.add(p); await db.commit(); await db.refresh(p)
    return {"id":p.id,"name":p.name,"color":p.color,"client":p.client,"archived":p.archived,"created_at":p.created_at.isoformat()+"Z"}

@router.put("/projects/{pid}")
async def update_project(pid: str, payload: ProjectCreate, db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(TimeProject).where(TimeProject.id == pid))
    p = r.scalar_one_or_none()
    if not p: raise HTTPException(404)
    p.name = payload.name; p.color = payload.color; p.client = payload.client
    await db.commit(); await db.refresh(p)
    return {"id":p.id,"name":p.name,"color":p.color,"client":p.client,"archived":p.archived}

@router.delete("/projects/{pid}", status_code=204)
async def delete_project(pid: str, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(TimeEntry).where(TimeEntry.project_id == pid))
    await db.execute(delete(TimeTask).where(TimeTask.project_id == pid))
    await db.execute(delete(TimeProject).where(TimeProject.id == pid))
    await db.commit()

# ── Tasks ─────────────────────────────────────────────────────────────────

@router.get("/tasks")
async def list_tasks(project_id: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    q = select(TimeTask)
    if project_id: q = q.where(TimeTask.project_id == project_id)
    r = await db.execute(q.order_by(TimeTask.created_at))
    return [{"id":t.id,"project_id":t.project_id,"name":t.name,"created_at":t.created_at.isoformat()+"Z"} for t in r.scalars().all()]

@router.post("/tasks", status_code=201)
async def create_task(payload: TaskCreate, db: AsyncSession = Depends(get_db)):
    t = TimeTask(id=str(uuid.uuid4()), project_id=payload.project_id, name=payload.name)
    db.add(t); await db.commit(); await db.refresh(t)
    return {"id":t.id,"project_id":t.project_id,"name":t.name,"created_at":t.created_at.isoformat()+"Z"}

@router.delete("/tasks/{tid}", status_code=204)
async def delete_task(tid: str, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(TimeTask).where(TimeTask.id == tid))
    await db.commit()

# ── Timer ─────────────────────────────────────────────────────────────────

@router.get("/running")
async def get_running(db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(TimeEntry).where(TimeEntry.end_time == None))
    e = r.scalar_one_or_none()
    if not e: return None
    # Calculate live duration
    elapsed = (datetime.utcnow() - e.start_time).total_seconds()
    d = _entry_out(e); d["duration"] = elapsed
    return d

@router.post("/start", status_code=201)
async def start_timer(payload: EntryCreate, db: AsyncSession = Depends(get_db)):
    # Stop any running timer first
    r = await db.execute(select(TimeEntry).where(TimeEntry.end_time == None))
    running = r.scalar_one_or_none()
    if running:
        running.end_time = datetime.utcnow()
        running.duration = (running.end_time - running.start_time).total_seconds()

    start = _parse_iso(payload.start_time) if payload.start_time else datetime.utcnow()
    e = TimeEntry(
        id=str(uuid.uuid4()), project_id=payload.project_id,
        task_id=payload.task_id, description=payload.description,
        tags=json.dumps(payload.tags), start_time=start,
    )
    db.add(e); await db.commit(); await db.refresh(e)
    return _entry_out(e)

@router.post("/stop")
async def stop_timer(db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(TimeEntry).where(TimeEntry.end_time == None))
    e = r.scalar_one_or_none()
    if not e: raise HTTPException(404, "No running timer")
    e.end_time = datetime.utcnow()
    e.duration = (e.end_time - e.start_time).total_seconds()
    await db.commit(); await db.refresh(e)
    return _entry_out(e)

# ── Entries ─────────────────────────────────────────────────────────────────

@router.get("/entries")
async def list_entries(
    from_date: Optional[str] = None,
    to_date:   Optional[str] = None,
    project_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    q = select(TimeEntry).where(TimeEntry.end_time != None).order_by(TimeEntry.start_time.desc())
    if from_date:
        q = q.where(TimeEntry.start_time >= datetime.fromisoformat(from_date))
    if to_date:
        q = q.where(TimeEntry.start_time <= datetime.fromisoformat(to_date) + timedelta(days=1))
    if project_id:
        q = q.where(TimeEntry.project_id == project_id)
    r = await db.execute(q.limit(500))
    return [_entry_out(e) for e in r.scalars().all()]

@router.post("/entries", status_code=201)
async def create_entry_manual(payload: EntryCreate, db: AsyncSession = Depends(get_db)):
    start = _parse_iso(payload.start_time) if payload.start_time else datetime.utcnow()
    e = TimeEntry(
        id=str(uuid.uuid4()), project_id=payload.project_id,
        task_id=payload.task_id, description=payload.description,
        tags=json.dumps(payload.tags), start_time=start,
        end_time=start,   # caller should update via PUT
    )
    db.add(e); await db.commit(); await db.refresh(e)
    return _entry_out(e)

@router.put("/entries/{eid}")
async def update_entry(eid: str, payload: EntryUpdate, db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(TimeEntry).where(TimeEntry.id == eid))
    e = r.scalar_one_or_none()
    if not e: raise HTTPException(404)
    if payload.project_id  is not None: e.project_id  = payload.project_id
    if payload.task_id     is not None: e.task_id     = payload.task_id
    if payload.description is not None: e.description = payload.description
    if payload.tags        is not None: e.tags        = json.dumps(payload.tags)
    if payload.start_time  is not None: e.start_time  = _parse_iso(payload.start_time)
    if payload.end_time    is not None: e.end_time    = _parse_iso(payload.end_time)
    if e.start_time and e.end_time:
        e.duration = max(0, (e.end_time - e.start_time).total_seconds())
    await db.commit(); await db.refresh(e)
    return _entry_out(e)

@router.delete("/entries/{eid}", status_code=204)
async def delete_entry_time(eid: str, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(TimeEntry).where(TimeEntry.id == eid))
    await db.commit()

# ── Reports ─────────────────────────────────────────────────────────────────

@router.get("/report/summary")
async def report_summary(
    from_date: str = Query(...),
    to_date:   str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """Returns daily totals and per-project breakdown for a date range."""
    q = (select(TimeEntry)
         .where(TimeEntry.end_time != None)
         .where(TimeEntry.start_time >= datetime.fromisoformat(from_date))
         .where(TimeEntry.start_time <= datetime.fromisoformat(to_date) + timedelta(days=1)))
    r = await db.execute(q)
    entries = r.scalars().all()

    # Per-day totals
    daily: dict[str, float] = {}
    # Per-project totals
    by_project: dict[str, float] = {}

    for e in entries:
        day = e.start_time.strftime("%Y-%m-%d")
        daily[day] = daily.get(day, 0) + (e.duration or 0)
        by_project[e.project_id] = by_project.get(e.project_id, 0) + (e.duration or 0)

    # Load project names
    proj_ids = list(by_project.keys())
    projects_map = {}
    if proj_ids:
        pr = await db.execute(select(TimeProject).where(TimeProject.id.in_(proj_ids)))
        for p in pr.scalars().all():
            projects_map[p.id] = {"name": p.name, "color": p.color}

    total = sum(e.duration or 0 for e in entries)

    return {
        "total_seconds": total,
        "daily": [{"date": d, "seconds": s} for d, s in sorted(daily.items())],
        "by_project": [
            {"project_id": pid, "seconds": s,
             "name": projects_map.get(pid, {}).get("name", "Unknown"),
             "color": projects_map.get(pid, {}).get("color", "#888")}
            for pid, s in sorted(by_project.items(), key=lambda x: -x[1])
        ]
    }

@router.get("/report/export")
async def export_csv(
    from_date: str = Query(...),
    to_date:   str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """Export time entries as CSV."""
    q = (select(TimeEntry)
         .where(TimeEntry.end_time != None)
         .where(TimeEntry.start_time >= datetime.fromisoformat(from_date))
         .where(TimeEntry.start_time <= datetime.fromisoformat(to_date) + timedelta(days=1))
         .order_by(TimeEntry.start_time))
    r = await db.execute(q)
    entries = r.scalars().all()

    proj_ids = list({e.project_id for e in entries})
    projects_map = {}
    if proj_ids:
        pr = await db.execute(select(TimeProject).where(TimeProject.id.in_(proj_ids)))
        for p in pr.scalars().all(): projects_map[p.id] = p.name

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Date", "Start", "End", "Duration (h)", "Project", "Task", "Description", "Tags"])
    for e in entries:
        dur_h = round((e.duration or 0) / 3600, 2)
        writer.writerow([
            e.start_time.strftime("%Y-%m-%d"),
            e.start_time.strftime("%H:%M"),
            e.end_time.strftime("%H:%M") if e.end_time else "",
            dur_h,
            projects_map.get(e.project_id, ""),
            e.task_id or "",
            e.description or "",
            ", ".join(_tags_to_list(e.tags)),
        ])

    buf.seek(0)
    filename = f"Headspace_Timelog_{from_date}_to_{to_date}.csv"
    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
