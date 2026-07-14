"""GET /assets — seeded plant assets for the Digital Twin."""

from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient


@pytest_asyncio.fixture
async def client():
    from app.core.config import get_settings
    from app.db.session import _asyncpg_dsn, apply_schema, engine
    from app.db.seed import seed_minimal
    from app.db.vector import close_vector_pool
    import asyncpg

    settings = get_settings()
    try:
        conn = await asyncpg.connect(_asyncpg_dsn(settings.database_url))
        await conn.close()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Postgres unreachable: {exc}")

    await close_vector_pool()
    await engine.dispose()
    await apply_schema()
    await seed_minimal()

    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    await close_vector_pool()
    await engine.dispose()


@pytest.mark.asyncio
async def test_list_assets(client: AsyncClient):
    resp = await client.get("/assets")
    assert resp.status_code == 200, resp.text
    assets = resp.json()
    assert len(assets) >= 4
    names = {a["name"] for a in assets}
    assert "Vessel A" in names
    assert all("id" in a and "zone" in a and "plant_id" in a for a in assets)
