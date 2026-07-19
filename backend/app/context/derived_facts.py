from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from shared.python.schemas import DerivedFact

INCOMPATIBLE_WORK_TYPE_PAIRS: frozenset[frozenset[str]] = frozenset(
    {frozenset({"hot_work", "confined_space"})}
)

HAZARDOUS_WORK_TYPES = frozenset({"hot_work", "confined_space"})


@dataclass(frozen=True)
class ContextEntryView:
    """In-memory view used by pure rule functions (no DB I/O)."""

    id: UUID
    asset_id: UUID
    category: str
    payload: dict[str, Any]
    provider: str
    valid_from: datetime
    valid_until: datetime
    confidence: float


def _active_permits(entries: list[ContextEntryView]) -> list[ContextEntryView]:
    return [
        e
        for e in entries
        if e.category == "permit" and e.payload.get("status") == "active"
    ]


def rule_elevated_gas(
    entries: list[ContextEntryView],
    *,
    now: datetime | None = None,
    threshold: float | None = None,
) -> DerivedFact | None:
    threshold = (
        threshold
        if threshold is not None
        else get_settings().gas_elevated_threshold
    )
    hits = [
        e
        for e in entries
        if e.category == "sensor"
        and isinstance(e.payload.get("gas_reading"), (int, float))
        and float(e.payload["gas_reading"]) > threshold
    ]
    if not hits:
        return None
    return _fact(hits[0].asset_id, "elevated_gas", True, [h.id for h in hits], now)


def rule_permit_conflict(
    entries: list[ContextEntryView],
    *,
    now: datetime | None = None,
) -> DerivedFact | None:
    permits = _active_permits(entries)
    if len(permits) < 2:
        return None
    return _fact(
        permits[0].asset_id,
        "permit_conflict",
        True,
        [p.id for p in permits],
        now,
    )


def rule_zone_occupied(
    entries: list[ContextEntryView],
    *,
    now: datetime | None = None,
) -> DerivedFact | None:
    hits = [
        e
        for e in entries
        if e.category == "worker_location"
        and e.payload.get("zone") == "hazardous"
    ]
    if not hits:
        return None
    return _fact(hits[0].asset_id, "zone_occupied", True, [h.id for h in hits], now)


def rule_incomplete_isolation(
    entries: list[ContextEntryView],
    *,
    now: datetime | None = None,
) -> DerivedFact | None:
    permits = [
        p
        for p in _active_permits(entries)
        if p.payload.get("work_type") in HAZARDOUS_WORK_TYPES
    ]
    if not permits:
        return None

    confirmed_ids = {
        e.payload.get("permit_id")
        for e in entries
        if e.category == "isolation_status"
        and e.payload.get("isolation_confirmed") is True
    }

    incomplete: list[ContextEntryView] = []
    for p in permits:
        pid = p.payload.get("permit_id")
        if pid is None or pid not in confirmed_ids:
            incomplete.append(p)

    if not incomplete:
        return None
    return _fact(
        incomplete[0].asset_id,
        "incomplete_isolation",
        True,
        [p.id for p in incomplete],
        now,
    )


def rule_simultaneous_ops(
    entries: list[ContextEntryView],
    *,
    now: datetime | None = None,
) -> DerivedFact | None:
    permits = _active_permits(entries)
    work_types = {
        str(p.payload.get("work_type"))
        for p in permits
        if p.payload.get("work_type")
    }
    for pair in INCOMPATIBLE_WORK_TYPE_PAIRS:
        if pair.issubset(work_types):
            return _fact(
                permits[0].asset_id,
                "simultaneous_ops",
                True,
                [p.id for p in permits],
                now,
            )
    return None


def rule_certification_expiring(
    entries: list[ContextEntryView],
    *,
    now: datetime | None = None,
    warning_days: int | None = None,
) -> DerivedFact | None:
    now = now or datetime.now(timezone.utc)
    warning_days = (
        warning_days
        if warning_days is not None
        else get_settings().cert_expiry_warning_days
    )
    deadline = now + timedelta(days=warning_days)

    on_site_worker_ids = {
        e.payload.get("worker_id")
        for e in entries
        if e.category == "worker_location" and e.payload.get("worker_id")
    }
    if not on_site_worker_ids:
        return None

    hits: list[ContextEntryView] = []
    for e in entries:
        if e.category != "certification":
            continue
        wid = e.payload.get("worker_id")
        if wid not in on_site_worker_ids:
            continue
        expires_raw = e.payload.get("expires_at")
        if not expires_raw:
            hits.append(e)
            continue
        expires = _parse_dt(expires_raw)
        if expires is not None and expires <= deadline:
            hits.append(e)

    if not hits:
        return None
    return _fact(
        hits[0].asset_id,
        "certification_expiring",
        True,
        [h.id for h in hits],
        now,
    )


def rule_over_temperature(
    entries: list[ContextEntryView],
    *,
    now: datetime | None = None,
    threshold: float | None = None,
) -> DerivedFact | None:
    threshold = (
        threshold
        if threshold is not None
        else get_settings().temp_elevated_threshold
    )
    hits = [
        e
        for e in entries
        if e.category == "sensor"
        and isinstance(e.payload.get("temp_reading"), (int, float))
        and float(e.payload["temp_reading"]) > threshold
    ]
    if not hits:
        return None
    return _fact(
        hits[0].asset_id, "over_temperature", True, [h.id for h in hits], now
    )


def rule_equipment_vibration_anomaly(
    entries: list[ContextEntryView],
    *,
    now: datetime | None = None,
    threshold: float | None = None,
) -> DerivedFact | None:
    threshold = (
        threshold
        if threshold is not None
        else get_settings().vibration_anomaly_threshold
    )
    hits = [
        e
        for e in entries
        if e.category == "sensor"
        and isinstance(e.payload.get("vibration_mm_s"), (int, float))
        and float(e.payload["vibration_mm_s"]) > threshold
    ]
    if not hits:
        return None
    return _fact(
        hits[0].asset_id,
        "equipment_vibration_anomaly",
        True,
        [h.id for h in hits],
        now,
    )


def rule_effluent_quality_breach(
    entries: list[ContextEntryView],
    *,
    now: datetime | None = None,
    ph_min: float | None = None,
    ph_max: float | None = None,
) -> DerivedFact | None:
    settings = get_settings()
    ph_min = ph_min if ph_min is not None else settings.effluent_ph_min
    ph_max = ph_max if ph_max is not None else settings.effluent_ph_max
    hits = [
        e
        for e in entries
        if e.category == "sensor"
        and isinstance(e.payload.get("ph"), (int, float))
        and (
            float(e.payload["ph"]) < ph_min or float(e.payload["ph"]) > ph_max
        )
    ]
    if not hits:
        return None
    return _fact(
        hits[0].asset_id,
        "effluent_quality_breach",
        True,
        [h.id for h in hits],
        now,
    )


def rule_tank_level_critical(
    entries: list[ContextEntryView],
    *,
    now: datetime | None = None,
    high_pct: float | None = None,
    low_pct: float | None = None,
) -> DerivedFact | None:
    settings = get_settings()
    high_pct = high_pct if high_pct is not None else settings.tank_level_high_pct
    low_pct = low_pct if low_pct is not None else settings.tank_level_low_pct
    hits = [
        e
        for e in entries
        if e.category == "sensor"
        and isinstance(e.payload.get("level_pct"), (int, float))
        and (
            float(e.payload["level_pct"]) > high_pct
            or float(e.payload["level_pct"]) < low_pct
        )
    ]
    if not hits:
        return None
    return _fact(
        hits[0].asset_id, "tank_level_critical", True, [h.id for h in hits], now
    )


def rule_ppe_noncompliance(
    entries: list[ContextEntryView],
    *,
    now: datetime | None = None,
) -> DerivedFact | None:
    hits = [
        e
        for e in entries
        if e.category == "ppe_status"
        and e.payload.get("compliant") is False
    ]
    if not hits:
        return None
    return _fact(
        hits[0].asset_id, "ppe_noncompliance", True, [h.id for h in hits], now
    )


def rule_lifting_operation_conflict(
    entries: list[ContextEntryView],
    *,
    now: datetime | None = None,
) -> DerivedFact | None:
    lifts = [
        e
        for e in entries
        if e.category == "lift_plan" and e.payload.get("status") == "active"
    ]
    if len(lifts) < 2:
        return None
    return _fact(
        lifts[0].asset_id,
        "lifting_operation_conflict",
        True,
        [p.id for p in lifts],
        now,
    )


def rule_weather_hold(
    entries: list[ContextEntryView],
    *,
    now: datetime | None = None,
    wind_threshold: float | None = None,
) -> DerivedFact | None:
    wind_threshold = (
        wind_threshold
        if wind_threshold is not None
        else get_settings().weather_wind_hold_ms
    )
    weather_hits = [
        e
        for e in entries
        if e.category == "weather"
        and (
            e.payload.get("lightning") is True
            or (
                isinstance(e.payload.get("wind_ms"), (int, float))
                and float(e.payload["wind_ms"]) >= wind_threshold
            )
        )
    ]
    if not weather_hits:
        return None

    exposed = [
        p
        for p in _active_permits(entries)
        if p.payload.get("work_type") in {"hot_work", "lifting"}
    ]
    active_lifts = [
        e
        for e in entries
        if e.category == "lift_plan" and e.payload.get("status") == "active"
    ]
    if not exposed and not active_lifts:
        return None

    sources = weather_hits + exposed + active_lifts
    return _fact(
        sources[0].asset_id,
        "weather_hold",
        True,
        [s.id for s in sources],
        now,
    )


def _parse_dt(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def _fact(
    asset_id: UUID,
    fact_type: str,
    value: bool,
    source_ids: list[UUID],
    now: datetime | None,
) -> DerivedFact:
    return DerivedFact(
        id=uuid4(),
        asset_id=asset_id,
        fact_type=fact_type,
        value=value,
        computed_at=now or datetime.now(timezone.utc),
        source_context_ids=source_ids,
    )


RuleFn = Callable[..., DerivedFact | None]

DERIVED_FACT_RULES: list[tuple[str, RuleFn]] = [
    ("elevated_gas", rule_elevated_gas),
    ("permit_conflict", rule_permit_conflict),
    ("zone_occupied", rule_zone_occupied),
    ("incomplete_isolation", rule_incomplete_isolation),
    ("simultaneous_ops", rule_simultaneous_ops),
    ("certification_expiring", rule_certification_expiring),
    ("over_temperature", rule_over_temperature),
    ("equipment_vibration_anomaly", rule_equipment_vibration_anomaly),
    ("effluent_quality_breach", rule_effluent_quality_breach),
    ("tank_level_critical", rule_tank_level_critical),
    ("ppe_noncompliance", rule_ppe_noncompliance),
    ("lifting_operation_conflict", rule_lifting_operation_conflict),
    ("weather_hold", rule_weather_hold),
]


def evaluate_rules(
    entries: list[ContextEntryView],
    *,
    now: datetime | None = None,
) -> dict[str, DerivedFact | None]:
    """Run all derived-fact rules. Returns fact_type → DerivedFact or None."""
    now = now or datetime.now(timezone.utc)
    return {name: fn(entries, now=now) for name, fn in DERIVED_FACT_RULES}


async def load_valid_context(
    session: AsyncSession,
    asset_id: UUID,
    *,
    now: datetime | None = None,
) -> list[ContextEntryView]:
    now = now or datetime.now(timezone.utc)
    result = await session.execute(
        text(
            """
            SELECT id, asset_id, category, payload, provider,
                   valid_from, valid_until, confidence
            FROM context_entries
            WHERE asset_id = CAST(:asset_id AS uuid)
              AND valid_from <= :now
              AND valid_until >= :now
            ORDER BY valid_from ASC
            """
        ),
        {"asset_id": str(asset_id), "now": now},
    )
    rows = result.fetchall()
    out: list[ContextEntryView] = []
    for row in rows:
        m = row._mapping
        payload = m["payload"]
        if isinstance(payload, str):
            import json

            payload = json.loads(payload)
        out.append(
            ContextEntryView(
                id=m["id"],
                asset_id=m["asset_id"],
                category=m["category"],
                payload=dict(payload),
                provider=m["provider"],
                valid_from=m["valid_from"],
                valid_until=m["valid_until"],
                confidence=float(m["confidence"]),
            )
        )
    return out


async def load_valid_context_for_assets(
    session: AsyncSession,
    asset_ids: list[UUID],
    *,
    now: datetime | None = None,
) -> list[ContextEntryView]:
    """Load currently-valid context entries for many assets (spatial neighborhood)."""
    if not asset_ids:
        return []
    now = now or datetime.now(timezone.utc)
    result = await session.execute(
        text(
            """
            SELECT id, asset_id, category, payload, provider,
                   valid_from, valid_until, confidence
            FROM context_entries
            WHERE asset_id = ANY(CAST(:asset_ids AS uuid[]))
              AND valid_from <= :now
              AND valid_until >= :now
            ORDER BY valid_from ASC
            """
        ),
        {"asset_ids": [str(a) for a in asset_ids], "now": now},
    )
    out: list[ContextEntryView] = []
    for row in result.fetchall():
        m = row._mapping
        payload = m["payload"]
        if isinstance(payload, str):
            import json

            payload = json.loads(payload)
        out.append(
            ContextEntryView(
                id=m["id"],
                asset_id=m["asset_id"],
                category=m["category"],
                payload=dict(payload),
                provider=m["provider"],
                valid_from=m["valid_from"],
                valid_until=m["valid_until"],
                confidence=float(m["confidence"]),
            )
        )
    return out


async def _latest_fact_value(
    session: AsyncSession, asset_id: UUID, fact_type: str
) -> bool | None:
    """Return last stored boolean value for fact_type, or None if never computed."""
    result = await session.execute(
        text(
            """
            SELECT value
            FROM derived_facts
            WHERE asset_id = CAST(:asset_id AS uuid)
              AND fact_type = :fact_type
            ORDER BY computed_at DESC
            LIMIT 1
            """
        ),
        {"asset_id": str(asset_id), "fact_type": fact_type},
    )
    row = result.first()
    if row is None:
        return None
    value = row[0]
    if isinstance(value, dict):
        # jsonb may wrap bool as JSON; asyncpg often returns Python bool directly
        return bool(value.get("value", value)) if "value" in value else bool(value)
    if isinstance(value, str):
        return value.lower() in ("true", "1")
    return bool(value)


async def compute_and_persist(
    session: AsyncSession,
    asset_id: UUID,
    *,
    now: datetime | None = None,
) -> tuple[list[DerivedFact], list[str]]:
    """
    Re-evaluate all rules for currently-valid context.
    Insert a derived_facts row only when the boolean value changes.
    Returns (current facts that are true, list of changed fact_types).
    """
    now = now or datetime.now(timezone.utc)
    entries = await load_valid_context(session, asset_id, now=now)
    evaluations = evaluate_rules(entries, now=now)

    current: list[DerivedFact] = []
    changed: list[str] = []

    import json

    for fact_type, fact in evaluations.items():
        new_value = True if fact is not None else False
        previous = await _latest_fact_value(session, asset_id, fact_type)

        if previous is None and not new_value:
            # Never seen + still false → nothing material happened.
            continue

        if previous is None or previous != new_value:
            # Persist change (including first false → true and true → false).
            source_ids = fact.source_context_ids if fact else []
            result = await session.execute(
                text(
                    """
                    INSERT INTO derived_facts (
                        asset_id, fact_type, value, computed_at, source_context_ids
                    )
                    VALUES (
                        CAST(:asset_id AS uuid),
                        :fact_type,
                        CAST(:value AS jsonb),
                        :computed_at,
                        :source_ids
                    )
                    RETURNING id, asset_id, fact_type, value, computed_at, source_context_ids
                    """
                ),
                {
                    "asset_id": str(asset_id),
                    "fact_type": fact_type,
                    "value": json.dumps(new_value),
                    "computed_at": now,
                    "source_ids": [str(i) for i in source_ids],
                },
            )
            row = result.one()
            m = row._mapping
            stored = DerivedFact(
                id=m["id"],
                asset_id=m["asset_id"],
                fact_type=m["fact_type"],
                value=new_value,
                computed_at=m["computed_at"],
                source_context_ids=list(m["source_context_ids"] or []),
            )
            changed.append(fact_type)
            if new_value:
                current.append(stored)
        elif new_value and fact is not None:
            # Unchanged true — surface latest stored id if possible, else ephemeral.
            prev_row = await session.execute(
                text(
                    """
                    SELECT id, asset_id, fact_type, value, computed_at, source_context_ids
                    FROM derived_facts
                    WHERE asset_id = CAST(:asset_id AS uuid)
                      AND fact_type = :fact_type
                    ORDER BY computed_at DESC
                    LIMIT 1
                    """
                ),
                {"asset_id": str(asset_id), "fact_type": fact_type},
            )
            r = prev_row.one()
            m = r._mapping
            current.append(
                DerivedFact(
                    id=m["id"],
                    asset_id=m["asset_id"],
                    fact_type=m["fact_type"],
                    value=True,
                    computed_at=m["computed_at"],
                    source_context_ids=list(m["source_context_ids"] or []),
                )
            )

    return current, changed
