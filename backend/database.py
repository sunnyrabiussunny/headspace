import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import text
from models.db_models import Base

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:////app/data/headspace.db")

# Convert plain sqlite:// to sqlite+aiosqlite://
if DATABASE_URL.startswith("sqlite:///"):
    DATABASE_URL = DATABASE_URL.replace("sqlite:///", "sqlite+aiosqlite:///", 1)

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session


async def _table_has_column(conn, table: str, column: str) -> bool:
    result = await conn.execute(text(f"PRAGMA table_info({table})"))
    cols = [row[1] for row in result.fetchall()]
    return column in cols


async def ensure_user_id_column(table: str):
    """SQLite ALTER TABLE ADD COLUMN migration — used for tables that existed
    before multi-user support was added, so old single-user databases keep
    working after upgrading."""
    await ensure_column(table, "user_id", "VARCHAR")


async def ensure_column(table: str, column: str, sqlite_type: str, default_sql: str | None = None):
    """Generic SQLite ALTER TABLE ADD COLUMN migration for any table/column
    that might already exist on a deployed database from before this column
    was introduced. default_sql, if given, is a literal SQL default
    (e.g. "0" or "'active'") — SQLite requires a constant, not an expression."""
    async with engine.begin() as conn:
        has_table = await conn.run_sync(
            lambda sync_conn: sync_conn.dialect.has_table(sync_conn, table)
        )
        if not has_table:
            return
        if not await _table_has_column(conn, table, column):
            default_clause = f" DEFAULT {default_sql}" if default_sql is not None else ""
            await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {sqlite_type}{default_clause}"))


async def backfill_owner(table: str, owner_id: str):
    """Assign any pre-existing rows with a NULL user_id to the given owner
    (run once, right after the first admin account is created)."""
    async with engine.begin() as conn:
        has_table = await conn.run_sync(
            lambda sync_conn: sync_conn.dialect.has_table(sync_conn, table)
        )
        if not has_table:
            return
        if not await _table_has_column(conn, table, "user_id"):
            return
        await conn.execute(
            text(f"UPDATE {table} SET user_id = :owner WHERE user_id IS NULL"),
            {"owner": owner_id},
        )
