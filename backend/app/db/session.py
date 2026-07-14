"""DB session plumbing — Phase 0 skeleton. Schema applied on startup when DB is reachable."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse, unquote

import asyncpg
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

settings = get_settings()
engine = create_async_engine(settings.database_url, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

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


async def get_session() -> AsyncSession:
    async with SessionLocal() as session:
        yield session
