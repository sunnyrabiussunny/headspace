import os
import json
import re
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import zipfile
import io
import uuid

from database import get_db
from models.db_models import DiaryEntry, KnowledgeObject
from models.schemas import DiaryEntryOut, ObjectOut

router = APIRouter(prefix="/api/export", tags=["export"])

BACKUP_DIR = os.getenv("BACKUP_DIR", "/app/data/backups")


def _get_backup_meta_path():
    return Path(BACKUP_DIR) / "backup_meta.json"


def _load_meta() -> dict:
    p = _get_backup_meta_path()
    if p.exists():
        with open(p) as f:
            return json.load(f)
    return {"last_backup": "", "entries_count": 0, "objects_count": 0}


def _save_meta(meta: dict):
    Path(BACKUP_DIR).mkdir(parents=True, exist_ok=True)
    with open(_get_backup_meta_path(), "w") as f:
        json.dump(meta, f, indent=2)


@router.get("/status")
async def export_status():
    meta = _load_meta()
    return {
        "last_backup": meta.get("last_backup", "Never"),
        "entries_count": meta.get("entries_count", 0),
        "objects_count": meta.get("objects_count", 0),
        "backup_dir": BACKUP_DIR,
    }


@router.post("/backup")
async def run_backup(db: AsyncSession = Depends(get_db)):
    """Export all data to BACKUP_DIR as Markdown plus JSON files."""
    Path(BACKUP_DIR).mkdir(parents=True, exist_ok=True)

    # Wipe previous backup
    import shutil
    diary_dir = Path(BACKUP_DIR) / "diary"
    obj_dir = Path(BACKUP_DIR) / "objects"
    if diary_dir.exists():
        shutil.rmtree(diary_dir)
    if obj_dir.exists():
        shutil.rmtree(obj_dir)
    diary_dir.mkdir()
    obj_dir.mkdir()

    # Diary entries
    entries_result = await db.execute(select(DiaryEntry).order_by(DiaryEntry.date))
    entries = entries_result.scalars().all()
    for entry in entries:
        md = f"# {entry.date}\n\n{entry.content}\n"
        if entry.tags:
            md += f"\nTags: {', '.join(entry.tags)}\n"
        (diary_dir / f"{entry.date}.md").write_text(md, encoding="utf-8")
        (diary_dir / f"{entry.id}.json").write_text(
            json.dumps({
                "id": entry.id,
                "date": entry.date,
                "content": entry.content,
                "tags": entry.tags or [],
                "created_at": entry.created_at.isoformat() if entry.created_at else "",
                "updated_at": entry.updated_at.isoformat() if entry.updated_at else "",
            }, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )

    # Objects
    objs_result = await db.execute(select(KnowledgeObject).order_by(KnowledgeObject.title))
    objs = objs_result.scalars().all()
    for obj in objs:
        safe = re.sub(r'[^\w\- ]', '_', obj.title)[:40]
        md = f"# {obj.title}\nType: {obj.type}\n"
        if obj.description:
            md += f"\n{obj.description}\n"
        if obj.notes:
            md += f"\n## Notes\n\n{obj.notes}\n"
        if obj.tags:
            md += f"\nTags: {', '.join(obj.tags)}\n"
        (obj_dir / f"{obj.type.lower()}_{safe}.md").write_text(md, encoding="utf-8")
        (obj_dir / f"{obj.id}.json").write_text(
            json.dumps({
                "id": obj.id,
                "type": obj.type,
                "title": obj.title,
                "description": obj.description,
                "notes": obj.notes,
                "tags": obj.tags or [],
                "properties": obj.properties or {},
                "created_at": obj.created_at.isoformat() if obj.created_at else "",
                "updated_at": obj.updated_at.isoformat() if obj.updated_at else "",
            }, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )

    timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    meta = {"last_backup": timestamp, "entries_count": len(entries), "objects_count": len(objs)}
    _save_meta(meta)

    return {"status": "ok", "timestamp": timestamp, "entries": len(entries), "objects": len(objs)}


@router.get("/download")
async def download_backup(db: AsyncSession = Depends(get_db)):
    """Download the entire backup as a zip file."""
    await run_backup(db)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in Path(BACKUP_DIR).rglob("*"):
            if f.is_file() and f.name != "backup_meta.json":
                zf.write(f, f.relative_to(BACKUP_DIR))
    buf.seek(0)

    from fastapi.responses import StreamingResponse
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M")
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=headspace_backup_{ts}.zip"}
    )


@router.post("/import")
async def import_backup(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    """Import diary entries and objects from uploaded JSON files or a zip."""
    content = await file.read()
    entries_count = 0
    objects_count = 0

    if file.filename and file.filename.endswith(".zip"):
        buf = io.BytesIO(content)
        with zipfile.ZipFile(buf) as zf:
            for name in zf.namelist():
                if not name.endswith(".json"):
                    continue
                data = json.loads(zf.read(name))
                if "diary" in name:
                    await _upsert_entry(db, data)
                    entries_count += 1
                elif "objects" in name or "object" in name:
                    await _upsert_object(db, data)
                    objects_count += 1
    else:
        data = json.loads(content)
        if isinstance(data, list):
            for item in data:
                if "date" in item and "content" in item:
                    await _upsert_entry(db, item)
                    entries_count += 1
                elif "type" in item and "title" in item:
                    await _upsert_object(db, item)
                    objects_count += 1

    await db.commit()
    return {"status": "ok", "entries_imported": entries_count, "objects_imported": objects_count}


async def _upsert_entry(db: AsyncSession, data: dict):
    from sqlalchemy import select
    result = await db.execute(select(DiaryEntry).where(DiaryEntry.id == data.get("id", "")))
    existing = result.scalar_one_or_none()
    if existing:
        existing.content = data.get("content", existing.content)
        existing.tags = data.get("tags", existing.tags)
    else:
        db.add(DiaryEntry(
            id=data.get("id", str(uuid.uuid4())),
            date=data.get("date", ""),
            content=data.get("content", ""),
            tags=data.get("tags", []),
        ))


async def _upsert_object(db: AsyncSession, data: dict):
    from sqlalchemy import select
    result = await db.execute(select(KnowledgeObject).where(KnowledgeObject.id == data.get("id", "")))
    existing = result.scalar_one_or_none()
    if existing:
        existing.title = data.get("title", existing.title)
        existing.notes = data.get("notes", existing.notes)
        existing.description = data.get("description", existing.description)
        existing.tags = data.get("tags", existing.tags)
    else:
        db.add(KnowledgeObject(
            id=data.get("id", str(uuid.uuid4())),
            type=data.get("type", "IDEA"),
            title=data.get("title", "Untitled"),
            description=data.get("description", ""),
            notes=data.get("notes", ""),
            tags=data.get("tags", []),
            properties=data.get("properties", {}),
        ))
