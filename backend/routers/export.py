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
    Import from a Capacities export zip.

    Capacities exports a zip containing:
      - Markdown files (.md) with YAML front matter for each note/object
      - CSV files for collections (optional)

    Folder name determines object type:
      Daily Notes/         → DiaryEntry (date from filename YYYY-MM-DD.md)
      People/              → PERSON
      Places/              → PLACE
      Books/ Movies/ Media/ Podcasts/ → MEDIA
      Organizations/       → ORGANIZATION
      Everything else      → IDEA (including tags, ideas, etc.)

    Accepts:
      - A zip file (Capacities full export)
      - A single .md file
      - A single .csv file
    """
    import csv as csv_mod
    import io as _io

    raw = await file.read()
    fname = (file.filename or "").lower()

    entries_count = 0
    objects_count = 0

    async def _upsert_entry(date_str: str, content_text: str, tags: list, entry_id: str = None):
        nonlocal entries_count
        eid = entry_id or str(uuid.uuid4())
        existing = await db.execute(select(DiaryEntry).where(DiaryEntry.id == eid))
        ex = existing.scalar_one_or_none()
        if ex:
            ex.content = (ex.content + "\n\n" + content_text).strip() if ex.content else content_text
            ex.tags = list(set((ex.tags or []) + tags))
        else:
            db.add(DiaryEntry(
                id=eid,
                date=date_str,
                content=content_text,
                tags=list(tags),
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            ))
        entries_count += 1

    async def _upsert_object(obj_type: str, title: str, description: str, notes: str, tags: list, obj_id: str = None):
        nonlocal objects_count
        if not title or not title.strip():
            return
        oid = obj_id or str(uuid.uuid4())
        existing = await db.execute(select(KnowledgeObject).where(KnowledgeObject.id == oid))
        ex = existing.scalar_one_or_none()
        if ex:
            ex.description = description or ex.description
            ex.notes = (notes or ex.notes)
            ex.tags = list(set((ex.tags or []) + tags))
        else:
            db.add(KnowledgeObject(
                id=oid,
                type=obj_type,
                title=title.strip(),
                description=description or "",
                notes=notes or "",
                tags=list(tags),
                properties={},
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            ))
        objects_count += 1

    def _parse_md(text: str):
        """Parse Markdown with optional YAML front matter. Returns (meta_dict, body_str)."""
        import re as _re
        meta = {}
        body = text
        fm_match = _re.match(r'^---\s*\n(.*?)\n---\s*\n', text, _re.DOTALL)
        if fm_match:
            body = text[fm_match.end():]
            for line in fm_match.group(1).splitlines():
                if ':' in line:
                    k, _, v = line.partition(':')
                    meta[k.strip()] = v.strip().strip('"').strip("'")
        return meta, body.strip()

    def _tags_from_meta(meta: dict) -> list:
        raw = meta.get('tags', '')
        if not raw:
            return []
        # YAML inline list: [tag1, tag2] or comma separated
        raw = raw.strip('[]')
        return [t.strip().lstrip('#') for t in raw.split(',') if t.strip()]

    def _folder_to_type(folder: str) -> str:
        import re as _re
        f = folder.lower().strip()
        # Explicit diary folder names used by Capacities
        diary_folders = {
            'daily notes', 'dailynotes', 'daily note', 'dailynote',
            'journal', 'journals', 'diary', 'diaries', 'calendar',
            'days', 'day', 'entries',
        }
        if f in diary_folders:
            return 'DIARY'
        # Depluralize and check again
        f_deplural = f.rstrip('s')
        if f_deplural in diary_folders:
            return 'DIARY'
        mapping = {
            'person':      'PERSON',
            'people':      'PERSON',
            'contact':     'PERSON',
            'contacts':    'PERSON',
            'place':       'PLACE',
            'places':      'PLACE',
            'location':    'PLACE',
            'locations':   'PLACE',
            'book':        'MEDIA',
            'books':       'MEDIA',
            'movie':       'MEDIA',
            'movies':      'MEDIA',
            'film':        'MEDIA',
            'films':       'MEDIA',
            'media':       'MEDIA',
            'podcast':     'MEDIA',
            'podcasts':    'MEDIA',
            'article':     'MEDIA',
            'articles':    'MEDIA',
            'video':       'MEDIA',
            'videos':      'MEDIA',
            'album':       'MEDIA',
            'albums':      'MEDIA',
            'organization':'ORGANIZATION',
            'organizations':'ORGANIZATION',
            'company':     'ORGANIZATION',
            'companies':   'ORGANIZATION',
            'team':        'ORGANIZATION',
            'teams':       'ORGANIZATION',
            'idea':        'IDEA',
            'ideas':       'IDEA',
            'concept':     'IDEA',
            'concepts':    'IDEA',
            'tag':         'IDEA',
            'tags':        'IDEA',
            'note':        'IDEA',
            'notes':       'IDEA',
            'project':     'IDEA',
            'projects':    'IDEA',
        }
        return mapping.get(f, mapping.get(f_deplural, 'IDEA'))

    def _date_from_filename(name: str):
        """Extract YYYY-MM-DD from filenames like 2024-06-15.md or 2024-06-15 Monday.md"""
        import re as _re
        m = _re.search(r'(\d{4}-\d{2}-\d{2})', name)
        return m.group(1) if m else None

    async def _process_md_file(folder: str, filename: str, text: str):
        meta, body = _parse_md(text)
        tags = _tags_from_meta(meta)

        # Priority 1: filename looks like a date → always a diary entry
        # Capacities names daily note files "2024-06-15.md" or "2024-06-15 Monday.md"
        date_from_file = _date_from_filename(filename)
        date_from_meta = meta.get('date', '')[:10] or meta.get('day', '')[:10]
        date_str = date_from_file or date_from_meta

        # Priority 2: folder name says diary
        folder_type = _folder_to_type(folder)

        if date_str and len(date_str) == 10:
            # Has a valid date → treat as diary entry regardless of folder
            await _upsert_entry(date_str, body, tags)
        elif folder_type == 'DIARY':
            # Folder says diary but no date found — skip (can't place it)
            return
        else:
            # It's a knowledge object
            title = (
                meta.get('title')
                or meta.get('name')
                or filename.replace('.md', '').strip()
            )
            description = meta.get('description', '')
            await _upsert_object(folder_type, title, description, body, tags)

    # ── Process input ───────────────────────────────────────────────────────

    if fname.endswith('.zip'):
        try:
            with zipfile.ZipFile(_io.BytesIO(raw)) as zf:
                for name in zf.namelist():
                    if name.endswith('/') or name.startswith('__MACOSX'):
                        continue
                    parts = name.replace('\\', '/').split('/')
                    # folder = first meaningful path component
                    folder = parts[-2] if len(parts) >= 2 else 'note'
                    filename = parts[-1]

                    if filename.endswith('.md'):
                        text = zf.read(name).decode('utf-8', errors='replace')
                        await _process_md_file(folder, filename, text)

                    elif filename.endswith('.csv'):
                        text = zf.read(name).decode('utf-8', errors='replace')
                        reader = csv_mod.DictReader(_io.StringIO(text))
                        obj_type = _folder_to_type(folder)
                        if obj_type == 'DIARY':
                            obj_type = 'IDEA'  # CSV daily notes edge case
                        for row in reader:
                            title = row.get('Title') or row.get('Name') or row.get('title') or ''
                            notes = row.get('Notes') or row.get('Content') or row.get('notes') or ''
                            desc  = row.get('Description') or row.get('description') or ''
                            tags  = [t.strip() for t in (row.get('Tags') or '').split(',') if t.strip()]
                            await _upsert_object(obj_type, title, desc, notes, tags)
        except zipfile.BadZipFile:
            raise HTTPException(400, "Invalid zip file")

    elif fname.endswith('.md'):
        text = raw.decode('utf-8', errors='replace')
        await _process_md_file('note', fname, text)

    elif fname.endswith('.csv'):
        text = raw.decode('utf-8', errors='replace')
        reader = csv_mod.DictReader(_io.StringIO(text))
        for row in reader:
            title = row.get('Title') or row.get('Name') or row.get('title') or ''
            notes = row.get('Notes') or row.get('Content') or row.get('notes') or ''
            desc  = row.get('Description') or row.get('description') or ''
            tags  = [t.strip() for t in (row.get('Tags') or '').split(',') if t.strip()]
            await _upsert_object('IDEA', title, desc, notes, tags)

    else:
        raise HTTPException(400, "Unsupported file type. Upload a Capacities export zip, a .md file, or a .csv file.")

    await db.commit()
    return {
        "status": "ok",
        "entries_imported": entries_count,
        "objects_imported": objects_count,
    }



@router.delete("/cleanup-date-objects")
async def cleanup_date_objects(db: AsyncSession = Depends(get_db)):
    """
    One-shot cleanup: delete all KnowledgeObjects whose title is a date
    (YYYY-MM-DD format) — these were wrongly imported as objects instead
    of diary entries during a bad Capacities import run.
    """
    import re as _re
    DATE_PAT = _re.compile(r'^\d{4}-\d{2}-\d{2}')
    result = await db.execute(select(KnowledgeObject))
    deleted = 0
    for obj in result.scalars().all():
        if obj.title and DATE_PAT.match(obj.title.strip()):
            await db.execute(delete(Mention).where(Mention.object_id == obj.id))
            await db.execute(delete(Mention).where(Mention.source_id == obj.id))
            await db.execute(delete(KnowledgeObject).where(KnowledgeObject.id == obj.id))
            deleted += 1
    await db.commit()
    return {"status": "ok", "deleted_date_objects": deleted}
