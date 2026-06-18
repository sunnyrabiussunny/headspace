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
    Import from a Capacities Markdown export.

    Handles two Capacities export formats:

    FORMAT A — Simple daily note (one file per day, wiki links):
        Today [[Sumaya Zahin]] and [[Farabi Tamal]] visited.
        Tamal Bhai recommended [[The Platform]].

    FORMAT B — Timestamped entries within a file (multiple entries per file):
        June 15, 2026, 12:38 I can say [SalesBoost CRM](../Ideas/SalesBoost CRM.md) is complete. #done
        June 15, 2026, 23:18 Finally [App: Priority Contacts](../Ideas/App Priority Contacts.md) is finished.

    Wiki links [[Name]] and Markdown links [Title](../Type/File.md) are resolved
    to existing objects or new ones are created from the link text + folder path.
    """
    import csv as csv_mod
    import io as _io
    import re as _re

    raw = await file.read()
    fname = (file.filename or "").lower()

    entries_count = 0
    objects_count = 0

    # Cache: title (lower) → object id, to avoid creating duplicates within one import
    obj_cache: dict[str, str] = {}

    # Pre-load existing objects into cache
    existing_objs = await db.execute(select(KnowledgeObject))
    for o in existing_objs.scalars().all():
        obj_cache[o.title.lower().strip()] = o.id

    async def _get_or_create_object(title: str, obj_type: str, properties: dict = None, description: str = "") -> str:
        """Return id of existing object with this title, or create and return new one."""
        key = title.lower().strip()
        if key in obj_cache:
            # Update URL if we now have one and it wasn't set before
            if properties and properties.get('url'):
                existing = await db.execute(select(KnowledgeObject).where(KnowledgeObject.id == obj_cache[key]))
                ex = existing.scalar_one_or_none()
                if ex and not ex.properties.get('url'):
                    ex.properties = {**ex.properties, **properties}
            return obj_cache[key]
        oid = str(uuid.uuid4())
        db.add(KnowledgeObject(
            id=oid,
            type=obj_type,
            title=title.strip(),
            description=description or "",
            notes="",
            tags=[],
            properties=properties or {},
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        ))
        obj_cache[key] = oid
        nonlocal objects_count
        objects_count += 1
        return oid

    def _path_to_type(rel_path: str) -> str:
        """Infer object type from a relative path like ../People/Name.md"""
        parts = rel_path.replace('\\', '/').split('/')
        # Find the folder component (skip ..)
        for part in parts:
            if part in ('..', '.', ''):
                continue
            folder = part.rstrip('.md').strip()
            t = _folder_to_type(folder)
            if t != 'IDEA':
                return t
            return t
        return 'IDEA'

    def _folder_to_type(folder: str) -> str:
        f = folder.lower().strip()
        diary_folders = {
            'daily notes', 'dailynotes', 'daily note', 'dailynote',
            'journal', 'journals', 'diary', 'diaries', 'calendar',
            'days', 'day', 'entries',
        }
        if f in diary_folders:
            return 'DIARY'
        mapping = {
            'person': 'PERSON', 'people': 'PERSON', 'contact': 'PERSON', 'contacts': 'PERSON',
            'place': 'PLACE', 'places': 'PLACE', 'location': 'PLACE', 'locations': 'PLACE',
            'book': 'MEDIA', 'books': 'MEDIA', 'movie': 'MEDIA', 'movies': 'MEDIA',
            'film': 'MEDIA', 'films': 'MEDIA', 'media': 'MEDIA', 'podcast': 'MEDIA',
            'podcasts': 'MEDIA', 'article': 'MEDIA', 'articles': 'MEDIA',
            'video': 'MEDIA', 'videos': 'MEDIA', 'album': 'MEDIA', 'albums': 'MEDIA',
            'organization': 'ORGANIZATION', 'organizations': 'ORGANIZATION',
            'company': 'ORGANIZATION', 'companies': 'ORGANIZATION',
            'team': 'ORGANIZATION', 'teams': 'ORGANIZATION',
            'idea': 'IDEA', 'ideas': 'IDEA', 'concept': 'IDEA', 'concepts': 'IDEA',
            'tag': 'IDEA', 'tags': 'IDEA', 'note': 'IDEA', 'notes': 'IDEA',
            'project': 'IDEA', 'projects': 'IDEA',
            'weblink': 'MEDIA', 'weblinks': 'MEDIA',
            'link': 'MEDIA', 'links': 'MEDIA',
            'url': 'MEDIA', 'urls': 'MEDIA',
            'website': 'MEDIA', 'websites': 'MEDIA',
            'bookmark': 'MEDIA', 'bookmarks': 'MEDIA',
        }
        return mapping.get(f, 'IDEA')

    def _date_from_filename(name: str):
        m = _re.search(r'(\d{4}-\d{2}-\d{2})', name)
        return m.group(1) if m else None

    def _parse_human_date(s: str):
        """Parse 'June 15, 2026' or 'June 15, 2026, 12:38' → (date_str, time_str)"""
        MONTHS = {
            'january':'01','february':'02','march':'03','april':'04',
            'may':'05','june':'06','july':'07','august':'08',
            'september':'09','october':'10','november':'11','december':'12',
            'jan':'01','feb':'02','mar':'03','apr':'04','jun':'06',
            'jul':'07','aug':'08','sep':'09','oct':'10','nov':'11','dec':'12',
        }
        # e.g. "June 15, 2026, 12:38" or "June 15, 2026"
        m = _re.match(
            r'(\w+)\s+(\d{1,2}),?\s+(\d{4})(?:,\s*(\d{1,2}):(\d{2}))?',
            s.strip(), _re.IGNORECASE
        )
        if not m:
            return None, None
        month_name = m.group(1).lower()
        month = MONTHS.get(month_name)
        if not month:
            return None, None
        day   = m.group(2).zfill(2)
        year  = m.group(3)
        date_str = f"{year}-{month}-{day}"
        time_str = f"{m.group(4).zfill(2)}:{m.group(5)}" if m.group(4) else "00:00"
        return date_str, time_str

    def _parse_yaml_front_matter(text: str):
        meta = {}
        body = text
        fm = _re.match(r'^---\s*\n(.*?)\n---\s*\n', text, _re.DOTALL)
        if fm:
            body = text[fm.end():]
            for line in fm.group(1).splitlines():
                if ':' in line:
                    k, _, v = line.partition(':')
                    meta[k.strip()] = v.strip().strip('"').strip("'")
        return meta, body.strip()

    def _tags_from_text(text: str) -> list:
        """Extract #hashtags from text."""
        return [m.lstrip('#').lower() for m in _re.findall(r'#([a-zA-Z0-9_\-]+)', text)]

    async def _convert_links(text: str, folder_context: str = '') -> str:
        """
        Convert Capacities link formats to Headspace @[Title](id) format.

        [[Name]]                            → @[Name](id)
        [Title](../Type/File.md)            → @[Title](id)
        [Title](../Weblinks/File.md)        → @[Title](id)  MEDIA object with URL in properties
        [Title](../Type/File%20Name.md)     → @[Title](id)  (URL-decoded)
        [Title](https://example.com)        → @[Title](id)  MEDIA object with URL stored
        """
        from urllib.parse import unquote as _unquote

        result = text

        # 0. Real URL links: [Title](https://...) or [Title](http://...)
        url_link_re = _re.compile(r'\[([^\]]+)\]\((https?://[^)]+)\)')
        url_matches = list(url_link_re.finditer(result))
        offset = 0
        for m in url_matches:
            title = m.group(1).strip()
            url   = m.group(2).strip()
            if not title or title.lower() in ('untitled', 'untitled - notes', ''):
                # Try to use domain as title
                domain_m = _re.search(r'https?://(?:www\.)?([^/]+)', url)
                title = domain_m.group(1) if domain_m else url[:40]
            oid = await _get_or_create_object(title, 'MEDIA', properties={'url': url})
            replacement = f'@[{title}]({oid})'
            start = m.start() + offset
            end   = m.end()   + offset
            result = result[:start] + replacement + result[end:]
            offset += len(replacement) - (m.end() - m.start())

        # 1. Markdown links: [Title](../Folder/File.md)
        md_link_re = _re.compile(r'\[([^\]]+)\]\(([^)]+\.md[^)]*)\)')
        async def _replace_md_link(m):
            title = m.group(1).strip()
            path  = _unquote(m.group(2))
            obj_type = _path_to_type(path)
            if obj_type == 'DIARY':
                obj_type = 'IDEA'
            # For weblinks, the title might be "Untitled" — try to clean it up
            if obj_type == 'MEDIA' and title.lower() in ('untitled', 'untitled - notes', ''):
                # Use filename without extension as title
                fname_part = path.split('/')[-1].replace('.md', '')
                fname_part = _unquote(fname_part).strip()
                if fname_part and fname_part.lower() != 'untitled':
                    title = fname_part
            oid = await _get_or_create_object(title, obj_type)
            return f'@[{title}]({oid})'

        # Process MD links
        md_matches = list(md_link_re.finditer(result))
        offset = 0
        for m in md_matches:
            replacement = await _replace_md_link(m)
            start = m.start() + offset
            end   = m.end()   + offset
            result = result[:start] + replacement + result[end:]
            offset += len(replacement) - (m.end() - m.start())

        # 2. Wiki links: [[Name]] — default to PERSON if unknown
        wiki_re = _re.compile(r'\[\[([^\]]+)\]\]')
        wiki_matches = list(wiki_re.finditer(result))
        offset = 0
        for m in wiki_matches:
            name = m.group(1).strip()
            # Heuristic: if name looks like a full person name (has space, title case), use PERSON
            words = name.split()
            if len(words) >= 2 and all(w[0].isupper() for w in words if w):
                obj_type = 'PERSON'
            else:
                obj_type = 'IDEA'
            oid = await _get_or_create_object(name, obj_type)
            replacement = f'@[{name}]({oid})'
            start = m.start() + offset
            end   = m.end()   + offset
            result = result[:start] + replacement + result[end:]
            offset += len(replacement) - (m.end() - m.start())

        return result

    # Timestamp pattern: "June 15, 2026, 12:38" at start of line
    TIMESTAMP_RE = _re.compile(
        r'^((?:January|February|March|April|May|June|July|August|September|October|November|December|'
        r'Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}(?:,\s*\d{1,2}:\d{2})?)\s+',
        _re.IGNORECASE | _re.MULTILINE
    )

    async def _process_md_file(folder: str, filename: str, text: str):
        meta, body = _parse_yaml_front_matter(text)
        date_from_file = _date_from_filename(filename)
        date_from_meta = meta.get('date', '')[:10] or meta.get('day', '')[:10]
        folder_type = _folder_to_type(folder)

        # ── Format B: file contains multiple timestamped entries ────────────
        ts_matches = list(TIMESTAMP_RE.finditer(body))
        if ts_matches:
            for i, m in enumerate(ts_matches):
                ts_str  = m.group(1)
                seg_start = m.end()
                seg_end   = ts_matches[i+1].start() if i+1 < len(ts_matches) else len(body)
                seg_text  = body[seg_start:seg_end].strip()
                if not seg_text:
                    continue

                date_str, time_str = _parse_human_date(ts_str)
                if not date_str:
                    continue

                converted = await _convert_links(seg_text, folder)
                tags = _tags_from_text(seg_text)

                eid = str(uuid.uuid4())
                hour, minute = (int(x) for x in time_str.split(':'))
                ts = datetime(int(date_str[:4]), int(date_str[5:7]), int(date_str[8:10]), hour, minute)
                db.add(DiaryEntry(
                    id=eid,
                    date=date_str,
                    content=converted,
                    tags=list(set(tags)),
                    created_at=ts,
                    updated_at=datetime.utcnow(),
                ))
                nonlocal entries_count
                entries_count += 1
            return

        # ── Format A / standard: single entry per file ──────────────────────
        date_str = date_from_file or date_from_meta

        if date_str and len(date_str) == 10:
            converted = await _convert_links(body, folder)
            tags = _tags_from_text(body)
            eid = str(uuid.uuid4())
            db.add(DiaryEntry(
                id=eid,
                date=date_str,
                content=converted,
                tags=list(set(tags)),
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            ))
            nonlocal entries_count
            entries_count += 1

        elif folder_type not in ('DIARY',):
            title = meta.get('title') or meta.get('name') or filename.replace('.md', '').strip()
            description = meta.get('description', '')
            # Extract URL from YAML front matter (Capacities Weblinks export)
            url = meta.get('url') or meta.get('link') or meta.get('href') or ''
            # Also scan body for a bare URL if this is a weblinks folder
            if not url and folder_type == 'MEDIA':
                url_m = _re.search(r'https?://\S+', body)
                if url_m:
                    url = url_m.group(0).rstrip(')')
            properties = {'url': url} if url else {}
            # Clean up "Untitled" titles for weblinks — use URL domain instead
            if title.lower() in ('untitled', 'untitled - notes', '') and url:
                domain_m = _re.search(r'https?://(?:www\.)?([^/]+)', url)
                title = domain_m.group(1) if domain_m else title
            converted = await _convert_links(body, folder)
            tags = _tags_from_text(body)
            await _get_or_create_object(title, folder_type, properties=properties, description=description)
            # Update notes on the newly created object
            key = title.lower().strip()
            oid = obj_cache.get(key)
            if oid:
                existing = await db.execute(select(KnowledgeObject).where(KnowledgeObject.id == oid))
                ex = existing.scalar_one_or_none()
                if ex:
                    ex.notes = converted
                    ex.description = description or ex.description
                    ex.tags = list(set((ex.tags or []) + tags))
                    if properties:
                        ex.properties = {**ex.properties, **properties}

    # ── Process input ────────────────────────────────────────────────────────

    if fname.endswith('.zip'):
        try:
            with zipfile.ZipFile(_io.BytesIO(raw)) as zf:
                for name in zf.namelist():
                    if name.endswith('/') or name.startswith('__MACOSX'):
                        continue
                    parts = name.replace('\\', '/').split('/')
                    folder   = parts[-2] if len(parts) >= 2 else 'note'
                    filename = parts[-1]

                    if filename.endswith('.md'):
                        text = zf.read(name).decode('utf-8', errors='replace')
                        await _process_md_file(folder, filename, text)

                    elif filename.endswith('.csv'):
                        text = zf.read(name).decode('utf-8', errors='replace')
                        reader = csv_mod.DictReader(_io.StringIO(text))
                        obj_type = _folder_to_type(folder)
                        if obj_type == 'DIARY':
                            obj_type = 'IDEA'
                        for row in reader:
                            title = row.get('Title') or row.get('Name') or row.get('title') or ''
                            notes = row.get('Notes') or row.get('Content') or row.get('notes') or ''
                            desc  = row.get('Description') or row.get('description') or ''
                            tags  = [t.strip() for t in (row.get('Tags') or '').split(',') if t.strip()]
                            if title:
                                await _get_or_create_object(title, obj_type)
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
            if title:
                await _get_or_create_object(title, 'IDEA')

    else:
        raise HTTPException(400, "Unsupported file. Upload a zip, .md, or .csv file.")

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
