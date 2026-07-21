"""
Packet hydration and hashing — pure logic, no database.

These guard the two claims the reports rework makes: that a frozen packet can be
proven unchanged, and that a report written before the rework still opens.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import uuid4

from app.reports.packet import (
    PACKET_VERSION,
    fact_label,
    hydrate_packet,
    normalize_content,
    packet_hash,
    report_ref,
    version_label,
)

from tests.report_fixtures import make_packet


def _row(content: dict, **overrides):
    row = {
        "id": uuid4(),
        "review_id": uuid4(),
        "closure_event_seq": 1,
        "packet_version": PACKET_VERSION,
        "content": content,
        "generated_at": datetime.now(timezone.utc),
        "frozen_at": datetime.now(timezone.utc),
        "closed_by": "api:close",
        "content_hash": None,
        "is_current": True,
    }
    row.update(overrides)
    return row


def test_packet_hash_is_stable_across_key_reordering():
    packet = make_packet()
    content = normalize_content(packet.model_dump(mode="json"))

    shuffled = json.loads(json.dumps(dict(reversed(list(content.items())))))
    assert packet_hash(shuffled) == packet_hash(content)


def test_packet_hash_survives_a_json_round_trip():
    """
    The write path hashes a Python dict; the read path hashes what jsonb gave
    back. If those disagree the UI shows a spurious "content altered" warning on
    an audit document, which is worse than no warning at all.
    """
    packet = make_packet()
    content = normalize_content(packet.model_dump(mode="json"))
    written = packet_hash(content)

    round_tripped = json.loads(json.dumps(content))
    assert packet_hash(round_tripped) == written


def test_packet_hash_changes_when_content_changes():
    packet = make_packet()
    content = normalize_content(packet.model_dump(mode="json"))
    before = packet_hash(content)

    content["decision"]["outcome"] = "approved"
    assert packet_hash(content) != before


def test_hydrate_v2_round_trips_and_stamps_identity():
    packet = make_packet()
    content = normalize_content(packet.model_dump(mode="json"))
    row = _row(content)

    hydrated = hydrate_packet(content, row=row)

    assert hydrated.meta.packet_version == PACKET_VERSION
    assert hydrated.meta.report_id == str(row["id"])
    assert hydrated.evidence.entries[0].summary_line == "gas 38.0% LEL · sensor GD-14"
    assert hydrated.decision is not None and hydrated.decision.outcome == "blocked"


def test_hydrate_takes_seq_from_the_column_not_the_content():
    """The schema's duplicate-renumbering UPDATE can make the two disagree."""
    packet = make_packet()
    content = normalize_content(packet.model_dump(mode="json"))
    content["meta"]["closure_event_seq"] = 99

    hydrated = hydrate_packet(content, row=_row(content, closure_event_seq=3))
    assert hydrated.meta.closure_event_seq == 3


def test_hydrate_legacy_v1_does_not_raise_and_flags_missing_evidence():
    """A pre-rework row must still open, with its gaps visible rather than blank."""
    ctx_ids = [str(uuid4()), str(uuid4())]
    legacy = {
        "title": "Closure Report — Vessel A (blocked)",
        "asset": {"id": str(uuid4()), "name": "Vessel A", "zone": "tank-farm",
                  "plant_id": "VSP-1", "floor": "ground"},
        "assessment_snapshot": {
            "id": str(uuid4()), "risk_level": "blocking", "summary": "Old summary",
            "version": 1,
            "recommendations": [
                {"id": str(uuid4()), "text": "Stop work", "rationale": "Gas",
                 "disposition": "accepted"}
            ],
            "metadata": {"provider": "mock", "retrieval_mode": "deterministic",
                         "retrieval_quality": "low", "confidence": 0.5},
        },
        "decision": {"id": str(uuid4()), "outcome": "blocked", "conditions": None,
                     "comments": None, "submitted_at": "2026-01-01T00:00:00+00:00"},
        "evidence": {"id": str(uuid4()), "frozen_context_ids": ctx_ids,
                     "frozen_assessment_id": str(uuid4()),
                     "captured_at": "2026-01-01T00:00:00+00:00"},
        "closure_event_seq": 1,
        "review": {"id": str(uuid4()), "state": "closed",
                   "triggered_by": "sensor_threshold", "owner_id": str(uuid4())},
    }

    hydrated = hydrate_packet(legacy, row=_row(legacy, packet_version=1))

    assert hydrated.meta.packet_version == 1
    assert hydrated.meta.built_from == "legacy_v1"
    assert hydrated.header.asset.name == "Vessel A"
    assert hydrated.decision is not None and hydrated.decision.outcome_label == "Blocked"
    assert hydrated.recommendations[0].rationale == "Gas"
    # v1 froze ids only — the entries must be present but explicitly unavailable,
    # so the gap is visible rather than looking like "no evidence existed".
    assert hydrated.evidence.source == "unavailable"
    assert len(hydrated.evidence.entries) == len(ctx_ids)
    assert "not frozen" in hydrated.evidence.entries[0].summary_line.lower()


def test_hydrate_malformed_v2_degrades_instead_of_raising():
    """A report you cannot open is worse than one with empty sections."""
    hydrated = hydrate_packet({"meta": "not-an-object"}, row=_row({}))
    assert hydrated is not None
    assert hydrated.meta.built_from == "unreadable_v2"


def test_labels_are_human():
    assert fact_label("elevated_gas") == "Gas above the early-warning threshold"
    assert fact_label("some_new_rule") == "Some new rule"
    assert version_label(3) == "v3"
    assert report_ref("11111111-2222-3333-4444-555555555555", 2) == "SOP-11111111-v2"
