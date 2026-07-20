"""Deterministic rule tools — agents ground conclusions in hard facts.

BLOCK verdicts must be backed by at least one true rule output.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from app.context.derived_facts import (
    DERIVED_FACT_RULES,
    ContextEntryView,
    evaluate_rules,
)

# Which fact types each source agent owns
AGENT_FACT_TYPES: dict[str, frozenset[str]] = {
    "scada": frozenset(
        {
            "elevated_gas",
            "critical_gas",
            "over_temperature",
            "critical_temperature",
            "equipment_vibration_anomaly",
            "effluent_quality_breach",
            "tank_level_critical",
            "weather_hold",
        }
    ),
    "permit": frozenset(
        {
            "permit_conflict",
            "simultaneous_ops",
            "lifting_operation_conflict",
        }
    ),
    "maintenance": frozenset({"incomplete_isolation"}),
    "workforce": frozenset(
        {
            "zone_occupied",
            "certification_expiring",
            "ppe_noncompliance",
        }
    ),
}

ALL_RULE_FACT_TYPES = frozenset(name for name, _ in DERIVED_FACT_RULES)


@dataclass
class RuleToolResult:
    fact_type: str
    active: bool
    detail: dict[str, Any]


class RuleToolkit:
    """Evaluate derived-fact rules over live context (or preloaded true facts)."""

    def __init__(
        self,
        *,
        context_entries: list[dict[str, Any]] | None = None,
        known_true_facts: list[str] | None = None,
        now: datetime | None = None,
    ) -> None:
        self.now = now or datetime.now(timezone.utc)
        self.known_true = set(known_true_facts or [])
        self._views = self._to_views(context_entries or [])
        self._evaluated: dict[str, bool] | None = None

    @staticmethod
    def _to_views(entries: list[dict[str, Any]]) -> list[ContextEntryView]:
        views: list[ContextEntryView] = []
        for e in entries:
            try:
                aid = e.get("asset_id")
                eid = e.get("id")
                if not aid or not eid:
                    continue
                views.append(
                    ContextEntryView(
                        id=UUID(str(eid)),
                        asset_id=UUID(str(aid)),
                        category=str(e.get("category") or ""),
                        payload=dict(e.get("payload") or {}),
                        provider=str(e.get("provider") or "unknown"),
                        valid_from=e.get("valid_from") or datetime.now(timezone.utc),
                        valid_until=e.get("valid_until")
                        or datetime.now(timezone.utc),
                        confidence=float(e.get("confidence") or 1.0),
                    )
                )
            except (TypeError, ValueError):
                continue
        return views

    def evaluate_all(self) -> dict[str, bool]:
        if self._evaluated is not None:
            return self._evaluated
        if self._views:
            results = evaluate_rules(self._views, now=self.now)
            self._evaluated = {
                name: (fact is not None and bool(fact.value))
                for name, fact in results.items()
            }
        else:
            self._evaluated = {
                name: name in self.known_true for name, _ in DERIVED_FACT_RULES
            }
        for ft in self.known_true:
            self._evaluated[ft] = True
        return self._evaluated

    def check(self, fact_type: str) -> RuleToolResult:
        all_facts = self.evaluate_all()
        active = bool(all_facts.get(fact_type, False))
        return RuleToolResult(
            fact_type=fact_type,
            active=active,
            detail={"source": "derived_fact_rule", "fact_type": fact_type},
        )

    def active_for_agent(self, agent: str) -> list[str]:
        owned = AGENT_FACT_TYPES.get(agent, frozenset())
        all_facts = self.evaluate_all()
        return sorted(ft for ft in owned if all_facts.get(ft))

    def all_active(self) -> list[str]:
        all_facts = self.evaluate_all()
        return sorted(ft for ft, active in all_facts.items() if active)


def require_grounding_for_block(
    risk_level: str, grounded_fact_types: list[str]
) -> str:
    """
    Enforce: BLOCK must be backed by ≥1 deterministic rule fact.
    Downgrades ungrounded blocking to elevated/nominal.
    """
    if risk_level != "blocking":
        return risk_level
    if grounded_fact_types:
        return "blocking"
    return "nominal"
