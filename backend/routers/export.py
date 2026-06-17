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


# ── Capacities Import ─────────────────────────────────────────────────────────

@router.post("/import-capacities")
async def import_capacities(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    """
    Import from a Capacities JSON export.
    Capacities exports a single JSON with keys like 'spaces', 'objects', 'dailyNotes', etc.
    We map:
      - dailyNotes / journal entries → DiaryEntry
      - objects (people, places, tags, etc.) → KnowledgeObject
    """
    content = await file.read()
    try:
        data = json.loads(content)
    except Exception:
        raise HTTPException(400, "Invalid JSON file")

    entries_count = 0
    objects_count = 0

    # Handle array of exports or single export object
    if isinstance(data, list):
        items = data
    elif isinstance(data, dict):
        items = []
        # Capacities structures: try common keys
        for key in ("dailyNotes", "journal", "entries", "notes"):
            if key in data and isinstance(data[key], list):
                items.extend(data[key])
        for key in ("objects", "people", "places", "media", "ideas", "tags"):
            if key in data and isinstance(data[key], list):
                items.extend(data[key])
        # If nothing matched, treat top-level as a single object
        if not items:
            items = [data]
    else:
        raise HTTPException(400, "Unrecognized Capacities export format")

    for item in items:
        if not isinstance(item, dict):
            continue

        # Detect diary/journal entries
        cap_type = (item.get("type") or item.get("objectType") or "").lower()
        has_date = "date" in item or "createdAt" in item or "day" in item

        if cap_type in ("dailynote", "journal", "note", "entry") or (
            has_date and ("content" in item or "text" in item or "body" in item)
        ):
            raw_date = item.get("date") or item.get("day") or item.get("createdAt", "")
            # Extract YYYY-MM-DD from ISO string
            date_str = str(raw_date)[:10] if raw_date else ""
            if not date_str or len(date_str) < 10:
                continue
            content_text = item.get("content") or item.get("text") or item.get("body") or ""
            tags = _extract_capacities_tags(item)
            entry_id = item.get("id") or str(uuid.uuid4())

            existing = await db.execute(select(DiaryEntry).where(DiaryEntry.id == entry_id))
            ex = existing.scalar_one_or_none()
            if ex:
                ex.content = ex.content + "\n\n" + content_text if ex.content else content_text
            else:
                db.add(DiaryEntry(
                    id=entry_id,
                    date=date_str,
                    content=content_text,
                    tags=tags,
                ))
            entries_count += 1

        else:
            # Knowledge object
            title = item.get("title") or item.get("name") or item.get("label") or ""
            if not title:
                continue

            obj_type = _map_capacities_type(cap_type)
            description = item.get("description") or item.get("subtitle") or ""
            notes = item.get("notes") or item.get("content") or item.get("text") or ""
            tags = _extract_capacities_tags(item)
            obj_id = item.get("id") or str(uuid.uuid4())

            existing = await db.execute(select(KnowledgeObject).where(KnowledgeObject.id == obj_id))
            ex = existing.scalar_one_or_none()
            if ex:
                ex.title = title
                ex.description = description or ex.description
                ex.notes = notes or ex.notes
            else:
                db.add(KnowledgeObject(
                    id=obj_id,
                    type=obj_type,
                    title=title,
                    description=description,
                    notes=notes,
                    tags=tags,
                    properties={},
                ))
            objects_count += 1

    await db.commit()
    return {
        "status": "ok",
        "entries_imported": entries_count,
        "objects_imported": objects_count,
    }


def _extract_capacities_tags(item: dict) -> list:
    tags = []
    for key in ("tags", "labels", "hashtags"):
        val = item.get(key)
        if isinstance(val, list):
            for t in val:
                if isinstance(t, str):
                    tags.append(t.lstrip("#"))
                elif isinstance(t, dict):
                    name = t.get("name") or t.get("title") or ""
                    if name:
                        tags.append(name.lstrip("#"))
    return list(set(tags))


def _map_capacities_type(cap_type: str) -> str:
    mapping = {
        "person": "PERSON",
        "contact": "PERSON",
        "place": "PLACE",
        "location": "PLACE",
        "media": "MEDIA",
        "book": "MEDIA",
        "movie": "MEDIA",
        "article": "MEDIA",
        "podcast": "MEDIA",
        "organization": "ORGANIZATION",
        "company": "ORGANIZATION",
        "idea": "IDEA",
        "concept": "IDEA",
        "tag": "IDEA",
    }
    return mapping.get(cap_type.lower(), "IDEA")
