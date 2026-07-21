from __future__ import annotations

from enum import Enum
from typing import Literal

ReviewState = Literal[
    "opened",
    "assessing",
    "pending_decision",
    "decided",
    "closed",
    "reopened",
]


class ReviewEvent(str, Enum):
    TRIGGER_ASSESSMENT = "trigger_assessment"
    ASSESSMENT_COMPLETED = "assessment_completed"
    SUBMIT_DECISION = "submit_decision"
    CLOSE = "close"
    REOPEN = "reopen"
    RISK_RETURNED = "risk_returned"


class IllegalTransitionError(Exception):
    def __init__(self, current: str, event: ReviewEvent) -> None:
        self.current = current
        self.event = event
        super().__init__(f"Illegal transition: state={current!r} event={event.value!r}")


# (current_state, event) -> next_state
TRANSITIONS: dict[tuple[ReviewState, ReviewEvent], ReviewState] = {
    ("opened", ReviewEvent.TRIGGER_ASSESSMENT): "assessing",
    ("assessing", ReviewEvent.ASSESSMENT_COMPLETED): "pending_decision",
    ("pending_decision", ReviewEvent.TRIGGER_ASSESSMENT): "assessing",
    ("pending_decision", ReviewEvent.SUBMIT_DECISION): "decided",
    ("decided", ReviewEvent.CLOSE): "closed",
    ("decided", ReviewEvent.REOPEN): "reopened",
    ("decided", ReviewEvent.RISK_RETURNED): "reopened",
    ("closed", ReviewEvent.REOPEN): "reopened",
    ("reopened", ReviewEvent.TRIGGER_ASSESSMENT): "assessing",
}


def next_state(current: ReviewState, event: ReviewEvent) -> ReviewState:
    """Pure transition table. Zero I/O."""
    key = (current, event)
    if key not in TRANSITIONS:
        raise IllegalTransitionError(current, event)
    return TRANSITIONS[key]
