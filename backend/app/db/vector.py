"""Dedicated asyncpg pool with pgvector registered — used by RAG + seed_embeddings."""

from __future__ import annotations

import logging
from typing import Any

import asyncpg
from pgvector.asyncpg import register_vector

from app.db.session import _asyncpg_dsn
from app.core.config import get_settings

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None


async def get_vector_pool() -> asyncpg.Pool:
    global _pool
    if _pool is not None:
        return _pool

    settings = get_settings()
    dsn = _asyncpg_dsn(settings.database_url)

    async def _init(conn: asyncpg.Connection) -> None:
        await register_vector(conn)

    _pool = await asyncpg.create_pool(dsn, min_size=1, max_size=4, init=_init)
    logger.info("vector pool ready")
    return _pool


async def close_vector_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def fetch(query: str, *args: Any) -> list[asyncpg.Record]:
    pool = await get_vector_pool()
    async with pool.acquire() as conn:
        return await conn.fetch(query, *args)


async def execute(query: str, *args: Any) -> str:
    pool = await get_vector_pool()
    async with pool.acquire() as conn:
        return await conn.execute(query, *args)
