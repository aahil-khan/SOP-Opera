"""DB session plumbing. Schema applied on startup when DB is reachable."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from pathlib import Path
from urllib.parse import unquote, urlparse

import asyncpg
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

settings = get_settings()
# Default pool is 5 + 10 overflow, while a single assessment job holds one
# connection for its entire agent run (retrieval + graph + LLM). With two workers
# and a handful of clients refetching on every broadcast, that ceiling is reached
# well before anything else in the system strains.
engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_pre_ping=True,
)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

# Seeded mode: NOT a second database. Mock rows (scripts/quick_mock_seed.py)
# live in this same primary database, tagged reviews.is_seeded — see
# schema.sql. This process-wide flag is a *query filter*, read by the list
# queries that matter (reviews/service.py::list_reviews,
# reports/repository.py::select_reports): off shows only is_seeded=false rows
# (real data), on shows everything (real + mock together, per explicit
# request — this replaced an earlier dual-database-switch design that showed
# mock data *instead of* real data rather than alongside it).
# Boot state comes from SEEDED_MODE_DEFAULT; a demo reset still forces it off
# (simulator/engine.py) so a reset lands on a clean live plant either way.
_seeded_mode = settings.seeded_mode_default


def get_seeded_mode() -> bool:
    return _seeded_mode


def set_seeded_mode(enabled: bool) -> bool:
    global _seeded_mode
    _seeded_mode = enabled
    return _seeded_mode


SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def _asyncpg_dsn(database_url: str) -> str:
    """Convert SQLAlchemy async URL → asyncpg DSN."""
    u = urlparse(database_url.replace("postgresql+asyncpg://", "postgresql://", 1))
    user = unquote(u.username or "")
    password = unquote(u.password or "")
    host = u.hostname or "localhost"
    port = u.port or 5432
    db = (u.path or "/").lstrip("/") or "postgres"
    return f"postgresql://{user}:{password}@{host}:{port}/{db}"


async def apply_schema() -> None:
    """Apply schema.sql via asyncpg (multi-statement). Soft-fail path is in lifespan."""
    sql = SCHEMA_PATH.read_text(encoding="utf-8")
    conn = await asyncpg.connect(_asyncpg_dsn(settings.database_url))
    try:
        await conn.execute(sql)
    finally:
        await conn.close()


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
