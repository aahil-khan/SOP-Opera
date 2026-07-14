from __future__ import annotations

import pytest

from app.reviews.state_machine import (
    TRANSITIONS,
    IllegalTransitionError,
    ReviewEvent,
    ReviewState,
    next_state,
)

ALL_STATES: list[ReviewState] = [
    "opened",
    "assessing",
    "pending_decision",
    "decided",
    "escalated",
    "closed",
    "reopened",
]


@pytest.mark.parametrize(
    ("current", "event", "expected"),
    [(curr, ev, nxt) for (curr, ev), nxt in TRANSITIONS.items()],
)
def test_legal_transitions(current: ReviewState, event: ReviewEvent, expected: ReviewState):
    assert next_state(current, event) == expected


def test_all_illegal_pairs_raise():
    legal = set(TRANSITIONS.keys())
    for state in ALL_STATES:
        for event in ReviewEvent:
            if (state, event) in legal:
                continue
            with pytest.raises(IllegalTransitionError):
                next_state(state, event)


def test_illegal_error_message():
    with pytest.raises(IllegalTransitionError) as exc:
        next_state("closed", ReviewEvent.ESCALATE)
    assert "closed" in str(exc.value)
    assert "escalate" in str(exc.value)
