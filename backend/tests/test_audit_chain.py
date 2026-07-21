"""Audit hash chain — pure-logic verification, no DB."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.audit.chain import (
    GENESIS_HASH,
    canonical_payload,
    compute_entry_hash,
    verify_rows,
)

T0 = datetime(2026, 3, 1, 9, 0, tzinfo=timezone.utc)


def _chain(n: int = 4) -> list[dict]:
    """Build a well-formed chain of n entries."""
    rows: list[dict] = []
    prev = GENESIS_HASH
    for i in range(n):
        row = {
            "id": uuid4(),
            "seq": i + 1,
            "entity_type": "review",
            "entity_id": uuid4(),
            "event_type": f"review.event{i}",
            "actor": "supervisor-1",
            "payload": {"step": i, "note": "ok"},
            "recorded_at": T0 + timedelta(minutes=i),
            "prev_hash": prev,
        }
        row["entry_hash"] = compute_entry_hash(
            prev_hash=prev,
            entity_type=row["entity_type"],
            entity_id=row["entity_id"],
            event_type=row["event_type"],
            actor=row["actor"],
            payload=row["payload"],
            recorded_at=row["recorded_at"],
        )
        prev = row["entry_hash"]
        rows.append(row)
    return rows


def test_untampered_chain_verifies():
    v = verify_rows(_chain())
    assert v.intact
    assert v.entries_checked == 4
    assert v.breaks == ()


def test_altering_a_payload_is_detected():
    """The point of the whole exercise."""
    rows = _chain()
    rows[1]["payload"] = {"step": 1, "note": "quietly changed"}

    v = verify_rows(rows)
    assert not v.intact
    reasons = {b.reason for b in v.breaks}
    assert "content_altered" in reasons
    # The edit also breaks every link after it.
    assert any(b.seq >= 3 for b in v.breaks)


def test_altering_the_actor_is_detected():
    rows = _chain()
    rows[2]["actor"] = "someone-else"
    assert not verify_rows(rows).intact


def test_deleting_an_entry_is_detected():
    rows = _chain()
    del rows[1]
    v = verify_rows(rows)
    assert not v.intact
    assert any(b.reason == "broken_link" for b in v.breaks)


def test_reordering_entries_is_detected():
    rows = _chain()
    rows[1], rows[2] = rows[2], rows[1]
    assert not verify_rows(rows).intact


def test_appending_a_forged_entry_is_detected():
    """An attacker adding a row without recomputing the chain."""
    rows = _chain()
    forged = dict(rows[-1])
    forged["id"] = uuid4()
    forged["seq"] = 99
    forged["event_type"] = "decision.approved"
    rows.append(forged)
    assert not verify_rows(rows).intact


def test_empty_chain_is_intact():
    v = verify_rows([])
    assert v.intact
    assert v.entries_checked == 0


def test_legacy_unhashed_rows_are_reported_not_flagged_as_tampering():
    """Rows written before the chain existed cannot be verified, but they are not
    evidence of tampering and must not reset the chain."""
    rows = [{"id": uuid4(), "seq": 1, "entry_hash": None, "prev_hash": None}]
    rows += _chain(2)
    v = verify_rows(rows)
    assert v.intact
    assert v.unhashed_entries == 1
    assert v.entries_checked == 2


def test_canonical_payload_is_key_order_independent():
    """Writer and verifier must agree regardless of dict ordering."""
    assert canonical_payload({"a": 1, "b": 2}) == canonical_payload({"b": 2, "a": 1})


def test_hash_is_delimited_so_fields_cannot_collide():
    common = dict(
        prev_hash=GENESIS_HASH,
        actor=None,
        payload={},
        recorded_at=T0,
        entity_id="11111111-1111-1111-1111-111111111111",
    )
    a = compute_entry_hash(entity_type="ab", event_type="c", **common)
    b = compute_entry_hash(entity_type="a", event_type="bc", **common)
    assert a != b


def test_chain_hash_changes_when_previous_entry_changes():
    """Each hash must actually depend on its predecessor."""
    common = dict(
        entity_type="review",
        entity_id="11111111-1111-1111-1111-111111111111",
        event_type="review.opened",
        actor="s1",
        payload={},
        recorded_at=T0,
    )
    assert compute_entry_hash(prev_hash=GENESIS_HASH, **common) != compute_entry_hash(
        prev_hash="f" * 64, **common
    )
