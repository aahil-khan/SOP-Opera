"""GET /api/config/thresholds — env-driven sensor and rule thresholds."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def client():
    from app.main import app

    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.mark.asyncio
async def test_thresholds_endpoint(client: AsyncClient):
    resp = await client.get("/api/config/thresholds")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    gas = body["sensors"]["gas_reading"]
    assert gas["elevated"] == 20.0
    assert gas["critical"] == 50.0

    temp = body["sensors"]["temp_reading"]
    assert temp["elevated"] == 80.0
    assert temp["critical"] == 120.0

    rules = body["rules"]
    assert rules["vibration_anomaly_threshold"] == 7.1
    assert rules["effluent_ph_min"] == 6.0
    assert rules["effluent_ph_max"] == 9.0
    assert rules["tank_level_high_pct"] == 95.0
    assert rules["weather_wind_hold_ms"] == 15.0
    assert rules["cert_expiry_warning_days"] == 14


@pytest.mark.asyncio
async def test_thresholds_reflect_env_override(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GAS_ELEVATED_THRESHOLD", "25.0")
    monkeypatch.setenv("GAS_CRITICAL_THRESHOLD", "55.0")

    from app.core.config import get_settings

    get_settings.cache_clear()

    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/api/config/thresholds")
    assert resp.status_code == 200
    gas = resp.json()["sensors"]["gas_reading"]
    assert gas["elevated"] == 25.0
    assert gas["critical"] == 55.0

    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_put_thresholds_updates_runtime(client: AsyncClient):
    from app.core.config import get_settings

    get_settings.cache_clear()
    resp = await client.put(
        "/api/config/thresholds",
        json={
            "sensors": {
                "gas_reading": {"elevated": 22.0, "critical": 48.0},
            }
        },
    )
    assert resp.status_code == 200, resp.text
    gas = resp.json()["sensors"]["gas_reading"]
    assert gas["elevated"] == 22.0
    assert gas["critical"] == 48.0

    again = await client.get("/api/config/thresholds")
    assert again.json()["sensors"]["gas_reading"]["critical"] == 48.0

    await client.put(
        "/api/config/thresholds",
        json={
            "sensors": {
                "gas_reading": {"elevated": 20.0, "critical": 50.0},
            }
        },
    )
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_put_thresholds_rejects_inverted_band(client: AsyncClient):
    resp = await client.put(
        "/api/config/thresholds",
        json={
            "sensors": {
                "gas_reading": {"elevated": 60.0, "critical": 40.0},
            }
        },
    )
    assert resp.status_code == 400
