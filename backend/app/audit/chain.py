"""
Hash chain for the audit trail.

The product's claim is a defensible record of who decided what, on what evidence.
`audit_entries` was an ordinary table: insert-only by convention in
`audit/service.py`, with nothing preventing an UPDATE or DELETE and no way to tell
afterwards that one had happened. "Immutable audit trail" was an overclaim.

Each entry now hashes its own content together with the previous entry's hash, so
any edit, deletion or reordering breaks every hash after it and
`verify_chain()` reports exactly where. This does not *prevent* tampering — a
database owner can always rewrite rows — it makes tampering **detectable**, which
is what an auditor actually needs.

`seq` (a BIGSERIAL) orders the chain rather than `recorded_at`, so clock skew and
identical timestamps cannot reorder it.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any
from uuid import UUID

GENESIS_HASH = "0" * 64
"""Previous-hash value for the first entry in the chain."""

# One writer at a time may append, so two concurrent inserts cannot both read the
# same tail and produce a forked chain. Transaction-scoped: released on commit.
AUDIT_CHAIN_LOCK_KEY = 8_417_302_115_446_021


def canonical_payload(payload: Any) -> str:
    """
    Stable JSON for hashing: sorted keys, no insignificant whitespace.

    Without this a semantically identical payload could hash differently between
    writer and verifier purely from dict ordering.
    """
    return json.dumps(
        payload if payload is not None else {},
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )


def compute_entry_hash(
    *,
    prev_hash: str,
    entity_type: str,
    entity_id: UUID | str,
    event_type: str,
    actor: str | None,
    payload: Any,
    recorded_at: Any,
) -> str:
    """
    SHA-256 over the previous hash plus this entry's content.

    Fields are joined with a delimiter that cannot appear in the values, so
    ("ab", "c") and ("a", "bc") cannot collide.
    """
    parts = [
        prev_hash,
        str(entity_type),
        str(entity_id),
        str(event_type),
        # Callers pass actor as a str or as an actor model; coerce so the hash
        # never depends on the caller's type choice.
        str(actor) if actor is not None else "",
        canonical_payload(payload),
        recorded_at.isoformat() if hasattr(recorded_at, "isoformat") else str(recorded_at),
    ]
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class ChainBreak:
    seq: int
    entry_id: str
    reason: str
    expected: str | None = None
    found: str | None = None


@dataclass(frozen=True)
class ChainVerification:
    entries_checked: int
    unhashed_entries: int
    """Rows written before the chain existed — reported, not treated as tampering."""
    breaks: tuple[ChainBreak, ...]

    @property
    def intact(self) -> bool:
        return not self.breaks

    def as_dict(self) -> dict[str, Any]:
        return {
            "intact": self.intact,
            "entries_checked": self.entries_checked,
            "unhashed_entries": self.unhashed_entries,
            "breaks": [
                {
                    "seq": b.seq,
                    "entry_id": b.entry_id,
                    "reason": b.reason,
                    "expected": b.expected,
                    "found": b.found,
                }
                for b in self.breaks
            ],
        }


def verify_rows(rows: list[dict[str, Any]]) -> ChainVerification:
    """
    Recompute the chain over `rows` (ordered by seq) and report every break.

    Pure function over already-fetched rows so it is unit-testable without a
    database.
    """
    breaks: list[ChainBreak] = []
    checked = 0
    unhashed = 0
    prev = GENESIS_HASH

    for row in rows:
        entry_hash = row.get("entry_hash")
        if not entry_hash:
            # Pre-existing row from before the chain was introduced. It cannot be
            # verified, but it must not silently reset the chain either.
            unhashed += 1
            continue

        checked += 1
        recorded_prev = row.get("prev_hash") or GENESIS_HASH
        if recorded_prev != prev:
            breaks.append(
                ChainBreak(
                    seq=int(row.get("seq") or 0),
                    entry_id=str(row.get("id")),
                    reason="broken_link",
                    expected=prev,
                    found=recorded_prev,
                )
            )

        expected_hash = compute_entry_hash(
            prev_hash=recorded_prev,
            entity_type=row.get("entity_type"),
            entity_id=row.get("entity_id"),
            event_type=row.get("event_type"),
            actor=row.get("actor"),
            payload=row.get("payload"),
            recorded_at=row.get("recorded_at"),
        )
        if expected_hash != entry_hash:
            breaks.append(
                ChainBreak(
                    seq=int(row.get("seq") or 0),
                    entry_id=str(row.get("id")),
                    reason="content_altered",
                    expected=expected_hash,
                    found=entry_hash,
                )
            )

        # Carry the *recomputed* hash forward, not the stored one. If this entry
        # was altered, the next entry's recorded prev_hash will no longer match,
        # so the damage surfaces as a broken link downstream too — which is the
        # property that makes the chain worth having. Using the stored hash here
        # would let a tampered entry heal the chain behind itself.
        prev = expected_hash

    return ChainVerification(
        entries_checked=checked,
        unhashed_entries=unhashed,
        breaks=tuple(breaks),
    )
