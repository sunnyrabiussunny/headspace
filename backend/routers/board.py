from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import Column, String, Integer, Boolean, Float, DateTime, select, delete
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import uuid

from database import get_db, engine
from models.db_models import Base   # same Base as rest of app

router = APIRouter(prefix="/api/board", tags=["board"])

# ── DB Models ─────────────────────────────────────────────────────────────────

class BoardBox(Base):
    __tablename__ = "board_boxes"
    id         = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    title      = Column(String, nullable=False, default="Untitled")
    color      = Column(String, nullable=False, default="#3dbfa0")
    x          = Column(Float, default=20)
    y          = Column(Float, default=20)
    w          = Column(Float, default=260)
    h          = Column(Float, default=220)
    z_index    = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)

class BoardItem(Base):
    __tablename__ = "board_items"
    id         = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    box_id     = Column(String, nullable=False, index=True)
    text       = Column(String, nullable=False, default="")
    done       = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

# ── Startup ───────────────────────────────────────────────────────────────────

async def init_board_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

# ── Schemas ──────────────────────────────────────────────────────────────────

class BoxCreate(BaseModel):
    title: str = "Untitled"
    color: str = "#3dbfa0"
    x: float = 20
    y: float = 20
    w: float = 260
    h: float = 220

class BoxUpdate(BaseModel):
    title:   Optional[str]   = None
    color:   Optional[str]   = None
    x:       Optional[float] = None
    y:       Optional[float] = None
    w:       Optional[float] = None
    h:       Optional[float] = None
    z_index: Optional[int]   = None

class ItemCreate(BaseModel):
    text: str

class ItemUpdate(BaseModel):
    text: Optional[str] = None
    done: Optional[bool] = None

# ── Helpers ──────────────────────────────────────────────────────────────────

async def _box_dict(db: AsyncSession, box: BoardBox):
    r = await db.execute(
        select(BoardItem).where(BoardItem.box_id == box.id)
        .order_by(BoardItem.sort_order, BoardItem.created_at)
    )
    items = r.scalars().all()
    return {
        "id": box.id, "title": box.title, "color": box.color,
        "x": box.x, "y": box.y, "w": box.w, "h": box.h, "z_index": box.z_index,
        "items": [
            {"id": i.id, "text": i.text, "done": i.done, "sort_order": i.sort_order}
            for i in items
        ],
    }

# ── Routes: boxes ────────────────────────────────────────────────────────────

@router.get("/boxes")
async def list_boxes(db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(BoardBox).order_by(BoardBox.z_index, BoardBox.created_at))
    boxes = r.scalars().all()
    return [await _box_dict(db, b) for b in boxes]

@router.post("/boxes")
async def create_box(payload: BoxCreate, db: AsyncSession = Depends(get_db)):
    top_r = await db.execute(select(BoardBox.z_index).order_by(BoardBox.z_index.desc()).limit(1))
    top = top_r.scalar_one_or_none() or 0
    box = BoardBox(
        id=str(uuid.uuid4()), title=payload.title.strip() or "Untitled",
        color=payload.color, x=payload.x, y=payload.y,
        w=payload.w, h=payload.h, z_index=top + 1,
    )
    db.add(box); await db.commit(); await db.refresh(box)
    return await _box_dict(db, box)

@router.put("/boxes/{box_id}")
async def update_box(box_id: str, payload: BoxUpdate, db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(BoardBox).where(BoardBox.id == box_id))
    box = r.scalar_one_or_none()
    if not box: raise HTTPException(404, "Box not found")
    if payload.title   is not None: box.title   = payload.title.strip() or "Untitled"
    if payload.color   is not None: box.color   = payload.color
    if payload.x       is not None: box.x       = payload.x
    if payload.y       is not None: box.y       = payload.y
    if payload.w       is not None: box.w       = max(180, payload.w)
    if payload.h       is not None: box.h       = max(120, payload.h)
    if payload.z_index is not None: box.z_index = payload.z_index
    await db.commit(); await db.refresh(box)
    return await _box_dict(db, box)

@router.post("/boxes/{box_id}/front")
async def bring_to_front(box_id: str, db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(BoardBox).where(BoardBox.id == box_id))
    box = r.scalar_one_or_none()
    if not box: raise HTTPException(404, "Box not found")
    top_r = await db.execute(select(BoardBox.z_index).order_by(BoardBox.z_index.desc()).limit(1))
    top = top_r.scalar_one_or_none() or 0
    box.z_index = top + 1
    await db.commit(); await db.refresh(box)
    return await _box_dict(db, box)

@router.delete("/boxes/{box_id}", status_code=204)
async def delete_box(box_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(BoardItem).where(BoardItem.box_id == box_id))
    await db.execute(delete(BoardBox).where(BoardBox.id == box_id))
    await db.commit()

# ── Routes: items ────────────────────────────────────────────────────────────

@router.post("/boxes/{box_id}/items")
async def create_item(box_id: str, payload: ItemCreate, db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(BoardBox).where(BoardBox.id == box_id))
    if not r.scalar_one_or_none(): raise HTTPException(404, "Box not found")
    count_r = await db.execute(select(BoardItem).where(BoardItem.box_id == box_id))
    order = len(count_r.scalars().all())
    item = BoardItem(id=str(uuid.uuid4()), box_id=box_id,
                      text=payload.text.strip(), sort_order=order)
    if not item.text:
        raise HTTPException(400, "text required")
    db.add(item); await db.commit(); await db.refresh(item)
    return {"id": item.id, "text": item.text, "done": item.done, "sort_order": item.sort_order}

@router.put("/items/{item_id}")
async def update_item(item_id: str, payload: ItemUpdate, db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(BoardItem).where(BoardItem.id == item_id))
    item = r.scalar_one_or_none()
    if not item: raise HTTPException(404, "Item not found")
    if payload.text is not None: item.text = payload.text.strip()
    if payload.done is not None: item.done = payload.done
    await db.commit(); await db.refresh(item)
    return {"id": item.id, "text": item.text, "done": item.done, "sort_order": item.sort_order}

@router.delete("/items/{item_id}", status_code=204)
async def delete_item(item_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(BoardItem).where(BoardItem.id == item_id))
    await db.commit()
