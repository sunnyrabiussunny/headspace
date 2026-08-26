import os
import secrets as _secrets
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from sqlalchemy import select

from database import init_db, ensure_user_id_column, backfill_owner, AsyncSessionLocal
from routers import diary, objects, search, export, tags, time, habits, board, auth_router, object_types
from models.db_models import User
from auth import hash_password

# Tables that existed before multi-user support was added — these need an
# ALTER TABLE migration for old, already-deployed databases. Fresh
# databases already get the column via Base.metadata.create_all.
LEGACY_TABLES = [
    "diary_entries", "knowledge_objects", "mentions",
    "time_projects", "time_tasks", "time_entries",
    "habits", "habit_completions",
    "board_boxes", "board_items",
]


async def _bootstrap_admin_and_migrate():
    for table in LEGACY_TABLES:
        await ensure_user_id_column(table)

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User))
        existing = result.scalars().first()
        if existing:
            return

        username = os.getenv("ADMIN_USERNAME", "admin").strip().lower()
        password = os.getenv("ADMIN_PASSWORD", "") or _secrets.token_urlsafe(9)
        generated = not os.getenv("ADMIN_PASSWORD")

        pw_hash, salt = hash_password(password)
        admin = User(
            username=username, display_name=username,
            password_hash=pw_hash, password_salt=salt, is_admin=True,
        )
        db.add(admin)
        await db.commit()
        await db.refresh(admin)

        if generated:
            print("=" * 60)
            print(" HEADSPACE — first-run admin account created")
            print(f"   username: {username}")
            print(f"   password: {password}")
            print(" Log in and change this password, or set ADMIN_USERNAME /")
            print(" ADMIN_PASSWORD in docker-compose.yml before first run.")
            print("=" * 60)

    for table in LEGACY_TABLES:
        await backfill_owner(table, admin.id)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    from routers.time import init_time_tables
    await init_time_tables()
    from routers.habits import init_habit_tables
    await init_habit_tables()
    from routers.board import init_board_tables
    await init_board_tables()
    from routers.object_types import init_object_type_tables
    await init_object_type_tables()
    await _bootstrap_admin_and_migrate()
    yield


app = FastAPI(title="Headspace API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(diary.router)
app.include_router(objects.router)
app.include_router(search.router)
app.include_router(export.router)
app.include_router(tags.router)
app.include_router(time.router)
app.include_router(habits.router)
app.include_router(board.router)
app.include_router(object_types.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "app": "headspace"}
