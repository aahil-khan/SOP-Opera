"""
Sensor coverage — "blind, not safe" (W3a).

Coverage is an **orthogonal field carried alongside `risk_level`**, never a
fourth risk level: `assessed | degraded | blind`. It never changes a verdict —
a blind channel withholds the nominal claim ("no data" is not "safe"), it does
not raise or block. `classify()`, the FSM and the eval harness are untouched.

Two detection halves, per the finals plan:

- **Self-reported degradation** (a sensor saying its own reading is suspect —
  low confidence or a fault payload) is a pure rule:
  `derived_facts.rule_sensor_unreliable`, called from here and deliberately not
  registered in DERIVED_FACT_RULES (see its docstring).
- **Staleness** (absence of data) lives here in the context read path, as a
  last-seen-per-asset query over *both* telemetry tables — hard-ingest
  `context_entries` and the always-on ambient ring `telemetry_samples`. A rule
  cannot observe silence, and neither table alone sees the whole live feed.

The canonical enum addition for `shared/` is routed to Aahil as a proposed diff
(`.claude/proposed-diffs/`); until it merges, this local type is the source.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.context.derived_facts import ContextEntryView, rule_sensor_unreliable
from app.core.config import get_settings

CoverageState = Literal["assessed", "degraded", "blind"]


@dataclass(frozen=True)
class AssetCoverage:
    asset_id: UUID
    coverage: CoverageState
    last_sensor_seen: datetime | None
    seconds_since_sensor: float | None
    reason: str


def _degraded_reason(entries: list[ContextEntryView], settings: Any) -> str:
    """
    Name what the sensor actually said, not just that something was wrong —
    the supervisor needs to know whether to trust the number or call an
    instrument tech, and "readings are suspect" answers neither.
    """
    floor = float(settings.sensor_confidence_floor)
    for e in entries:
        if e.category != "sensor":
            continue
        if e.payload.get("fault") is True or e.payload.get("status") == "fault":
            code = e.payload.get("fault_code")
            detail = f" ({code})" if code else ""
            return (
                f"Sensor reported a fault{detail} — the channel is reporting, "
                "but it says its own reading is untrustworthy."
            )
        if e.confidence < floor:
            return (
                f"Sensor reported confidence {e.confidence:.2f}, below the "
                f"{floor:.2f} floor — reading is present but not dependable."
            )
    return "A sensor reported low confidence or a fault — readings are suspect."


def classify_coverage(
    *,
    valid_entries: list[ContextEntryView],
    last_sensor_seen: datetime | None,
    now: datetime | None = None,
    stale_after_seconds: float | None = None,
) -> tuple[CoverageState, str]:
    """
    Coverage for one asset: staleness first (blind beats degraded), then
    self-reported unreliability, else assessed.
    """
    settings = get_settings()
    now = now or datetime.now(timezone.utc)
    stale_after = (
        stale_after_seconds
        if stale_after_seconds is not None
        else float(settings.sensor_stale_after_seconds)
    )

    if last_sensor_seen is None:
        return "blind", "No sensor reading has ever arrived for this asset."
    age = (now - last_sensor_seen).total_seconds()
    if age > stale_after:
        return (
            "blind",
            f"No sensor reading for {int(age // 60)} min "
            f"(stale after {int(stale_after)}s) — absence of data, not safety.",
        )

    if rule_sensor_unreliable(valid_entries, now=now) is not None:
        return "degraded", _degraded_reason(valid_entries, settings)

    return "assessed", "Sensor data current and self-reported healthy."


async def sensor_last_seen(
    session: AsyncSession, asset_ids: list[UUID] | None = None
) -> dict[UUID, datetime]:
    """
    Latest sensor arrival per asset — regardless of validity window, so a
    reading that expired still counts as "last heard from" for staleness math.

    Reads **both** halves of the live telemetry path, because they are separate
    tables and neither alone answers "when did we last hear from this asset":

    - `context_entries` — hard ingest (scenarios, `POST /context`, the webhook,
      the ambient heartbeat). Low rate, opens reviews, computes derived facts.
    - `telemetry_samples` — the always-on ambient soft tick, which is what
      actually keeps every asset warm (`simulator/ambient.py::_soft_tick` →
      `telemetry_store.persist_samples`). It never touches `context_entries`.

    Querying only `context_entries` measured staleness against a table the
    ambient heartbeat never updates, so every asset read as blind — the plant
    rendered uninstrumented rather than assessed-and-nominal.

    Note `telemetry_samples` is a bounded ring (`ambient_telemetry_keep` rows
    per asset), which is fine here: pruning drops the *oldest* rows, never the
    newest, so the MAX this needs always survives.

    Seeded demonstration rows are excluded. `scripts/quick_mock_seed.py` writes
    `category='sensor'` entries with `provider='quick_mock'`, and counting them
    would make an asset read `assessed` on the strength of a mock reading — with
    seeded mode off, and with nothing having actually been heard. That inverts
    the point of this module: `assessed` has to mean a real channel reported,
    not that a demo row exists. `telemetry_samples` needs no equivalent filter —
    the seeder never writes it.
    """
    # Kept as a tuple so adding a future seeder is a one-line change here rather
    # than a new WHERE clause to forget.
    seeded_providers = ("quick_mock",)
    where_ctx = "AND provider <> ALL(CAST(:seeded_providers AS text[]))"
    where_tel = ""
    params: dict = {"seeded_providers": list(seeded_providers)}
    if asset_ids is not None:
        where_ctx += " AND asset_id = ANY(CAST(:asset_ids AS uuid[]))"
        where_tel += " AND asset_id = ANY(CAST(:asset_ids AS uuid[]))"
        params["asset_ids"] = [str(a) for a in asset_ids]
    result = await session.execute(
        text(
            f"""
            SELECT asset_id, MAX(last_seen) AS last_seen
            FROM (
                SELECT asset_id, MAX(valid_from) AS last_seen
                FROM context_entries
                WHERE category = 'sensor' {where_ctx}
                GROUP BY asset_id
                UNION ALL
                SELECT asset_id, MAX(ts) AS last_seen
                FROM telemetry_samples
                WHERE category = 'sensor' {where_tel}
                GROUP BY asset_id
            ) heard
            GROUP BY asset_id
            """
        ),
        params,
    )
    return {
        row._mapping["asset_id"]: row._mapping["last_seen"]
        for row in result.fetchall()
    }


async def coverage_for_assets(
    session: AsyncSession,
    *,
    now: datetime | None = None,
) -> list[AssetCoverage]:
    """Coverage for every asset — the twin, AI Ops and assessments read this."""
    from app.context.derived_facts import load_valid_context_for_assets

    now = now or datetime.now(timezone.utc)
    assets = await session.execute(text("SELECT id FROM assets"))
    asset_ids = [row._mapping["id"] for row in assets.fetchall()]
    if not asset_ids:
        return []

    last_seen = await sensor_last_seen(session, asset_ids)
    entries = await load_valid_context_for_assets(session, asset_ids, now=now)
    by_asset: dict[UUID, list[ContextEntryView]] = {a: [] for a in asset_ids}
    for e in entries:
        by_asset.setdefault(e.asset_id, []).append(e)

    out: list[AssetCoverage] = []
    for aid in asset_ids:
        seen = last_seen.get(aid)
        state, reason = classify_coverage(
            valid_entries=by_asset.get(aid, []),
            last_sensor_seen=seen,
            now=now,
        )
        out.append(
            AssetCoverage(
                asset_id=aid,
                coverage=state,
                last_sensor_seen=seen,
                seconds_since_sensor=(
                    (now - seen).total_seconds() if seen is not None else None
                ),
                reason=reason,
            )
        )
    return out


async def coverage_for_asset(
    session: AsyncSession,
    asset_id: UUID,
    *,
    now: datetime | None = None,
) -> AssetCoverage:
    from app.context.derived_facts import load_valid_context

    now = now or datetime.now(timezone.utc)
    last_seen = (await sensor_last_seen(session, [asset_id])).get(asset_id)
    entries = await load_valid_context(session, asset_id, now=now)
    state, reason = classify_coverage(
        valid_entries=entries, last_sensor_seen=last_seen, now=now
    )
    return AssetCoverage(
        asset_id=asset_id,
        coverage=state,
        last_sensor_seen=last_seen,
        seconds_since_sensor=(
            (now - last_seen).total_seconds() if last_seen is not None else None
        ),
        reason=reason,
    )
