import os
import json
import re
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Header
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
import zipfile
import io
import uuid

from database import get_db, AsyncSessionLocal
from models.db_models import DiaryEntry, KnowledgeObject, Mention, User
from models.schemas import DiaryEntryOut, ObjectOut
from auth import get_current_user

router = APIRouter(prefix="/api/export", tags=["export"])

BACKUP_DIR = os.getenv("BACKUP_DIR", "/app/data/backups")
CRON_SECRET = os.getenv("CRON_SECRET", "")


def _user_backup_dir(username: str) -> Path:
    safe = re.sub(r'[^\w\-]', '_', username)
    return Path(BACKUP_DIR) / safe


def _get_backup_meta_path(username: str):
    return _user_backup_dir(username) / "backup_meta.json"


def _load_meta(username: str) -> dict:
    p = _get_backup_meta_path(username)
    if p.exists():
        with open(p) as f:
            return json.load(f)
    return {"last_backup": "", "entries_count": 0, "objects_count": 0}


def _save_meta(username: str, meta: dict):
    _user_backup_dir(username).mkdir(parents=True, exist_ok=True)
    with open(_get_backup_meta_path(username), "w") as f:
        json.dump(meta, f, indent=2)


@router.get("/status")
async def export_status(current_user: User = Depends(get_current_user)):
    meta = _load_meta(current_user.username)
    return {
        "last_backup": meta.get("last_backup", "Never"),
        "entries_count": meta.get("entries_count", 0),
        "objects_count": meta.get("objects_count", 0),
        "backup_dir": str(_user_backup_dir(current_user.username)),
    }


async def _run_backup_for_user(db: AsyncSession, user: User) -> dict:
    """Export one user's data (diary, objects, board, habits, time) to their
    own backup subfolder as Markdown plus JSON files. Shared by the
    interactive /backup endpoint and the cron-driven /backup-all endpoint
    that a cloud-sync script (rclone etc.) can call for everyone at once."""
    import shutil
    from routers.board import BoardBox, BoardItem
    from routers.habits import Habit, HabitCompletion
    from routers.time import TimeProject, TimeTask, TimeEntry

    user_dir = _user_backup_dir(user.username)
    user_dir.mkdir(parents=True, exist_ok=True)

    diary_dir = user_dir / "diary"
    obj_dir   = user_dir / "objects"
    board_dir = user_dir / "board"
    for d in (diary_dir, obj_dir, board_dir):
        if d.exists():
            shutil.rmtree(d)
        d.mkdir()

    # ── Diary entries ────────────────────────────────────────────────────
    entries_result = await db.execute(select(DiaryEntry).where(DiaryEntry.user_id == user.id).order_by(DiaryEntry.date))
    entries = entries_result.scalars().all()
    for entry in entries:
        md = f"# {entry.date}\n\n{entry.content}\n"
        if entry.tags:
            md += f"\nTags: {', '.join(entry.tags)}\n"
        (diary_dir / f"{entry.date}.md").write_text(md, encoding="utf-8")
        (diary_dir / f"{entry.id}.json").write_text(
            json.dumps({
                "id": entry.id, "date": entry.date, "content": entry.content,
                "tags": entry.tags or [],
                "created_at": entry.created_at.isoformat() if entry.created_at else "",
                "updated_at": entry.updated_at.isoformat() if entry.updated_at else "",
            }, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )

    # ── Objects ──────────────────────────────────────────────────────────
    objs_result = await db.execute(select(KnowledgeObject).where(KnowledgeObject.user_id == user.id).order_by(KnowledgeObject.title))
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
                "id": obj.id, "type": obj.type, "title": obj.title,
                "description": obj.description, "notes": obj.notes,
                "tags": obj.tags or [], "properties": obj.properties or {},
                "created_at": obj.created_at.isoformat() if obj.created_at else "",
                "updated_at": obj.updated_at.isoformat() if obj.updated_at else "",
            }, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )

    # ── Board (boxes + checklist items) ─────────────────────────────────
    boxes_result = await db.execute(select(BoardBox).where(BoardBox.user_id == user.id).order_by(BoardBox.z_index))
    boxes = boxes_result.scalars().all()
    board_export = []
    board_md_lines = ["# Board\n"]
    for box in boxes:
        items_result = await db.execute(select(BoardItem).where(BoardItem.box_id == box.id, BoardItem.user_id == user.id).order_by(BoardItem.sort_order))
        items = items_result.scalars().all()
        board_export.append({
            "id": box.id, "title": box.title, "color": box.color,
            "x": box.x, "y": box.y, "w": box.w, "h": box.h, "z_index": box.z_index,
            "items": [{"id": i.id, "text": i.text, "done": i.done} for i in items],
        })
        board_md_lines.append(f"\n## {box.title}\n")
        for i in items:
            board_md_lines.append(f"- [{'x' if i.done else ' '}] {i.text}")
    (board_dir / "board.json").write_text(json.dumps(board_export, ensure_ascii=False, indent=2), encoding="utf-8")
    (board_dir / "board.md").write_text("\n".join(board_md_lines) + "\n", encoding="utf-8")

    # ── Habits ───────────────────────────────────────────────────────────
    habits_result = await db.execute(select(Habit).where(Habit.user_id == user.id).order_by(Habit.sort_order))
    habits = habits_result.scalars().all()
    completions_result = await db.execute(select(HabitCompletion).where(HabitCompletion.user_id == user.id))
    completions = completions_result.scalars().all()
    habits_export = {
        "habits": [{"id": h.id, "title": h.title, "icon": h.icon} for h in habits],
        "completions": [{"habit_id": c.habit_id, "date": c.date} for c in completions],
    }
    (user_dir / "habits.json").write_text(json.dumps(habits_export, ensure_ascii=False, indent=2), encoding="utf-8")

    # ── Time tracker ─────────────────────────────────────────────────────
    projects_result = await db.execute(select(TimeProject).where(TimeProject.user_id == user.id))
    projects = projects_result.scalars().all()
    tasks_result = await db.execute(select(TimeTask).where(TimeTask.user_id == user.id))
    tasks = tasks_result.scalars().all()
    time_entries_result = await db.execute(select(TimeEntry).where(TimeEntry.user_id == user.id))
    time_entries = time_entries_result.scalars().all()
    time_export = {
        "projects": [{"id": p.id, "name": p.name, "color": p.color, "client": p.client} for p in projects],
        "tasks": [{"id": t.id, "project_id": t.project_id, "name": t.name} for t in tasks],
        "entries": [{
            "id": e.id, "project_id": e.project_id, "task_id": e.task_id,
            "description": e.description, "tags": e.tags,
            "start_time": e.start_time.isoformat() if e.start_time else "",
            "end_time": e.end_time.isoformat() if e.end_time else "",
            "duration": e.duration,
        } for e in time_entries],
    }
    (user_dir / "time.json").write_text(json.dumps(time_export, ensure_ascii=False, indent=2), encoding="utf-8")

    timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    meta = {
        "last_backup": timestamp, "entries_count": len(entries), "objects_count": len(objs),
        "board_boxes_count": len(boxes), "habits_count": len(habits), "time_entries_count": len(time_entries),
    }
    _save_meta(user.username, meta)
    return {"status": "ok", "timestamp": timestamp, "entries": len(entries), "objects": len(objs), "board_boxes": len(boxes)}


@router.post("/backup")
async def run_backup(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Export the current user's data to BACKUP_DIR as Markdown plus JSON files."""
    return await _run_backup_for_user(db, current_user)


@router.post("/backup-all")
async def run_backup_all(x_cron_secret: str = Header(default="")):
    """
    Back up EVERY user's data in one pass. Intended to be called by an
    external cron job / systemd timer (see scripts/backup-to-cloud.sh),
    not from the app UI — protected by a shared secret (CRON_SECRET env
    var) instead of a per-user login token.
    """
    if not CRON_SECRET or x_cron_secret != CRON_SECRET:
        raise HTTPException(401, "Invalid or missing cron secret")
    results = []
    async with AsyncSessionLocal() as db:
        users_result = await db.execute(select(User))
        for user in users_result.scalars().all():
            results.append({"username": user.username, **(await _run_backup_for_user(db, user))})
    return {"status": "ok", "users_backed_up": len(results), "results": results}


@router.get("/download")
async def download_backup(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Download the current user's entire backup as a zip file."""
    await _run_backup_for_user(db, current_user)
    user_dir = _user_backup_dir(current_user.username)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in user_dir.rglob("*"):
            if f.is_file() and f.name != "backup_meta.json":
                zf.write(f, f.relative_to(user_dir))
    buf.seek(0)

    from fastapi.responses import StreamingResponse
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M")
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=headspace_backup_{ts}.zip"}
    )


@router.post("/import")
async def import_backup(file: UploadFile = File(...), current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Import diary entries and objects from uploaded JSON files or a zip, into the current user's account."""
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
                    await _upsert_entry(db, data, current_user.id)
                    entries_count += 1
                elif "objects" in name or "object" in name:
                    await _upsert_object(db, data, current_user.id)
                    objects_count += 1
    else:
        data = json.loads(content)
        if isinstance(data, list):
            for item in data:
                if "date" in item and "content" in item:
                    await _upsert_entry(db, item, current_user.id)
                    entries_count += 1
                elif "type" in item and "title" in item:
                    await _upsert_object(db, item, current_user.id)
                    objects_count += 1

    await db.commit()
    return {"status": "ok", "entries_imported": entries_count, "objects_imported": objects_count}


async def _upsert_entry(db: AsyncSession, data: dict, user_id: str):
    result = await db.execute(select(DiaryEntry).where(DiaryEntry.id == data.get("id", ""), DiaryEntry.user_id == user_id))
    existing = result.scalar_one_or_none()
    if existing:
        existing.content = data.get("content", existing.content)
        existing.tags = data.get("tags", existing.tags)
    else:
        db.add(DiaryEntry(
            id=data.get("id", str(uuid.uuid4())),
            user_id=user_id,
            date=data.get("date", ""),
            content=data.get("content", ""),
            tags=data.get("tags", []),
        ))


async def _upsert_object(db: AsyncSession, data: dict, user_id: str):
    result = await db.execute(select(KnowledgeObject).where(KnowledgeObject.id == data.get("id", ""), KnowledgeObject.user_id == user_id))
    existing = result.scalar_one_or_none()
    if existing:
        existing.title = data.get("title", existing.title)
        existing.notes = data.get("notes", existing.notes)
        existing.description = data.get("description", existing.description)
        existing.tags = data.get("tags", existing.tags)
    else:
        db.add(KnowledgeObject(
            id=data.get("id", str(uuid.uuid4())),
            user_id=user_id,
            type=data.get("type", "IDEA"),
            title=data.get("title", "Untitled"),
            description=data.get("description", ""),
            notes=data.get("notes", ""),
            tags=data.get("tags", []),
            properties=data.get("properties", {}),
        ))


# ── Capacities Import ─────────────────────────────────────────────────────────

@router.post("/import-capacities")
async def import_capacities(file: UploadFile = File(...), current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """
    Import from a Capacities Markdown export, into the current user's account.

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
    user_id = current_user.id

    entries_count = 0
    objects_count = 0

    # Cache: title (lower) → object id, to avoid creating duplicates within one import
    obj_cache: dict[str, str] = {}

    # Pre-load existing objects (this user's only) into cache
    existing_objs = await db.execute(select(KnowledgeObject).where(KnowledgeObject.user_id == user_id))
    for o in existing_objs.scalars().all():
        obj_cache[o.title.lower().strip()] = o.id

    async def _get_or_create_object(title: str, obj_type: str, properties: dict = None, description: str = "") -> str:
        """Return id of existing object with this title, or create and return new one."""
        nonlocal objects_count
        key = title.lower().strip()
        if key in obj_cache:
            if properties and properties.get('url'):
                existing = await db.execute(select(KnowledgeObject).where(KnowledgeObject.id == obj_cache[key], KnowledgeObject.user_id == user_id))
                ex = existing.scalar_one_or_none()
                if ex and not ex.properties.get('url'):
                    ex.properties = {**ex.properties, **properties}
            return obj_cache[key]
        oid = str(uuid.uuid4())
        db.add(KnowledgeObject(
            id=oid,
            user_id=user_id,
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
        objects_count += 1
        return oid

    def _path_to_type(rel_path: str) -> str:
        parts = rel_path.replace('\\', '/').split('/')
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
        tags = []
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith('#'):
                continue
            for m in _re.finditer(r'(?<![#\w])#([a-zA-Z][a-zA-Z0-9_]{0,39})', line):
                tag = m.group(1).lower()
                if '--' in tag or tag.startswith('-'):
                    continue
                tags.append(tag)
        return list(set(tags))

    async def _convert_links(text: str, folder_context: str = '') -> str:
        from urllib.parse import unquote as _unquote

        result = text

        url_link_re = _re.compile(r'\[([^\]]+)\]\((https?://[^)]+)\)')
        url_matches = list(url_link_re.finditer(result))
        offset = 0
        for m in url_matches:
            title = m.group(1).strip()
            url   = m.group(2).strip()
            if not title or title.lower() in ('untitled', 'untitled - notes', ''):
                domain_m = _re.search(r'https?://(?:www\.)?([^/]+)', url)
                title = domain_m.group(1) if domain_m else url[:40]
            oid = await _get_or_create_object(title, 'MEDIA', properties={'url': url})
            replacement = f'@[{title}]({oid})'
            start = m.start() + offset
            end   = m.end()   + offset
            result = result[:start] + replacement + result[end:]
            offset += len(replacement) - (m.end() - m.start())

        md_link_re = _re.compile(r'\[([^\]]+)\]\(([^)]+\.md[^)]*)\)')
        async def _replace_md_link(m):
            title = m.group(1).strip()
            path  = _unquote(m.group(2))
            obj_type = _path_to_type(path)
            if obj_type == 'DIARY':
                obj_type = 'IDEA'
            if obj_type == 'MEDIA' and title.lower() in ('untitled', 'untitled - notes', ''):
                fname_part = path.split('/')[-1].replace('.md', '')
                fname_part = _unquote(fname_part).strip()
                if fname_part and fname_part.lower() != 'untitled':
                    title = fname_part
            oid = await _get_or_create_object(title, obj_type)
            return f'@[{title}]({oid})'

        md_matches = list(md_link_re.finditer(result))
        offset = 0
        for m in md_matches:
            replacement = await _replace_md_link(m)
            start = m.start() + offset
            end   = m.end()   + offset
            result = result[:start] + replacement + result[end:]
            offset += len(replacement) - (m.end() - m.start())

        wiki_re = _re.compile(r'\[\[([^\]]+)\]\]')
        wiki_matches = list(wiki_re.finditer(result))
        offset = 0
        for m in wiki_matches:
            name = m.group(1).strip()
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

    TIMESTAMP_RE = _re.compile(
        r'^((?:January|February|March|April|May|June|July|August|September|October|November|December|'
        r'Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}(?:,\s*\d{1,2}:\d{2})?)\s+',
        _re.IGNORECASE | _re.MULTILINE
    )

    async def _process_md_file(folder: str, filename: str, text: str):
        nonlocal entries_count, objects_count
        meta, body = _parse_yaml_front_matter(text)
        date_from_file = _date_from_filename(filename)
        date_from_meta = meta.get('date', '')[:10] or meta.get('day', '')[:10]
        folder_type = _folder_to_type(folder)

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
                    user_id=user_id,
                    date=date_str,
                    content=converted,
                    tags=list(set(tags)),
                    created_at=ts,
                    updated_at=datetime.utcnow(),
                ))
                entries_count += 1
            return

        date_str = date_from_file or date_from_meta

        if date_str and len(date_str) == 10:
            converted = await _convert_links(body, folder)
            tags = _tags_from_text(body)
            eid = str(uuid.uuid4())
            db.add(DiaryEntry(
                id=eid,
                user_id=user_id,
                date=date_str,
                content=converted,
                tags=list(set(tags)),
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            ))
            entries_count += 1

        elif folder_type not in ('DIARY',):
            title = meta.get('title') or meta.get('name') or filename.replace('.md', '').strip()
            description = meta.get('description', '')
            url = meta.get('url') or meta.get('link') or meta.get('href') or ''
            if not url and folder_type == 'MEDIA':
                url_m = _re.search(r'https?://\S+', body)
                if url_m:
                    url = url_m.group(0).rstrip(')')
            properties = {'url': url} if url else {}
            if title.lower() in ('untitled', 'untitled - notes', '') and url:
                domain_m = _re.search(r'https?://(?:www\.)?([^/]+)', url)
                title = domain_m.group(1) if domain_m else title
            converted = await _convert_links(body, folder)
            tags = _tags_from_text(body)
            await _get_or_create_object(title, folder_type, properties=properties, description=description)
            key = title.lower().strip()
            oid = obj_cache.get(key)
            if oid:
                existing = await db.execute(select(KnowledgeObject).where(KnowledgeObject.id == oid, KnowledgeObject.user_id == user_id))
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


@router.delete("/cleanup-junk-tags")
async def cleanup_junk_tags(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """
    Remove junk tags that were created from Capacities markdown heading anchors.
    These look like: #-artemis---llm, #-background, #-career-snapshot etc.
    Rule: delete any tag that starts with '-' OR contains '--' OR is longer than 40 chars.
    """
    import re as _re
    JUNK = _re.compile(r'^-|--|[^a-zA-Z0-9_\-]|^.{41,}')

    diary_result = await db.execute(select(DiaryEntry).where(DiaryEntry.user_id == current_user.id))
    cleaned_entries = 0
    for entry in diary_result.scalars().all():
        if not entry.tags:
            continue
        clean = [t for t in entry.tags if not JUNK.search(t)]
        if len(clean) != len(entry.tags):
            entry.tags = clean
            cleaned_entries += 1

    obj_result = await db.execute(select(KnowledgeObject).where(KnowledgeObject.user_id == current_user.id))
    cleaned_objects = 0
    for obj in obj_result.scalars().all():
        if not obj.tags:
            continue
        clean = [t for t in obj.tags if not JUNK.search(t)]
        if len(clean) != len(obj.tags):
            obj.tags = clean
            cleaned_objects += 1

    await db.commit()
    return {
        "status": "ok",
        "cleaned_entries": cleaned_entries,
        "cleaned_objects": cleaned_objects,
    }


@router.delete("/delete-all")
async def delete_all_data(confirm: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """
    Nuclear option — delete ALL of the current user's diary entries, objects,
    mentions, board, habits and time data. Requires ?confirm=DELETEALL in the
    query string. Only affects the logged-in account — never other users.
    """
    if confirm != "DELETEALL":
        raise HTTPException(400, "Confirmation string must be exactly: DELETEALL")

    from routers.time import TimeEntry, TimeProject, TimeTask
    from routers.board import BoardBox, BoardItem
    from routers.habits import Habit, HabitCompletion

    uid = current_user.id
    await db.execute(delete(Mention).where(Mention.user_id == uid))
    await db.execute(delete(DiaryEntry).where(DiaryEntry.user_id == uid))
    await db.execute(delete(KnowledgeObject).where(KnowledgeObject.user_id == uid))
    await db.execute(delete(TimeEntry).where(TimeEntry.user_id == uid))
    await db.execute(delete(TimeProject).where(TimeProject.user_id == uid))
    await db.execute(delete(TimeTask).where(TimeTask.user_id == uid))
    await db.execute(delete(BoardItem).where(BoardItem.user_id == uid))
    await db.execute(delete(BoardBox).where(BoardBox.user_id == uid))
    await db.execute(delete(HabitCompletion).where(HabitCompletion.user_id == uid))
    await db.execute(delete(Habit).where(Habit.user_id == uid))
    await db.commit()

    return {"status": "ok", "message": "All of your data has been deleted"}
