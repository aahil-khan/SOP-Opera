"""
Citation validation — a generated summary may only name references it retrieved.

`AssessmentResult` has no citation field: the prose summary is free text, and the
only thing previously stopping a model from writing "per OISD-STD-105 s.7.2" was
a line in the prompt saying not to. That produced a real failure mode — a summary
citing a clause sitting next to a "Cited evidence" panel that does not contain it,
which is exactly what a reviewer checking grounding would probe first.

This module extracts citation-shaped tokens from generated prose and checks them
against the codes actually retrieved for that assessment. Unsupported citations
are reported so the caller can strip them and flag the assessment, rather than
persisting a claim the evidence does not back.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

# Citation shapes that appear in this corpus. Deliberately narrow: a false
# positive here would strip legitimate prose.
CITATION_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bOISD[-\s]?(?:STD|GDN|RP)?[-\s]?\d+[A-Za-z0-9.\-]*", re.IGNORECASE),
    re.compile(r"\bFactor(?:ies|y)\s+Act(?:,)?\s*(?:19\d{2})?\s*(?:s\.?|§|Section\s*)\s*\d+[A-Z]?(?:\(\d+\))?(?:\([a-z]\))?", re.IGNORECASE),
    re.compile(r"\bDGMS\b[^.,;]{0,60}", re.IGNORECASE),
    re.compile(r"\bOSHA[-\s]?\d+(?:\.\d+)*", re.IGNORECASE),
    re.compile(r"\bAPI[-\s](?:RP|STD)[-\s]?\d+", re.IGNORECASE),
    re.compile(r"\bNFPA[-\s]?\d+[A-Z]?", re.IGNORECASE),
    re.compile(r"\bISO[-\s]?\d{4,5}", re.IGNORECASE),
)


def _normalize(text: str) -> str:
    """Fold case, punctuation and spacing so 'OISD STD 105' == 'OISD-STD-105'."""
    return re.sub(r"[^a-z0-9]", "", text.lower())


@dataclass(frozen=True)
class CitationCheck:
    cited: tuple[str, ...]
    """Citation-shaped tokens found in the prose."""
    supported: tuple[str, ...]
    unsupported: tuple[str, ...]
    """Cited but absent from the retrieved references — these are hallucinations."""

    @property
    def ok(self) -> bool:
        return not self.unsupported


def extract_citations(text: str | None) -> list[str]:
    if not text:
        return []
    found: list[str] = []
    for pattern in CITATION_PATTERNS:
        for match in pattern.finditer(text):
            token = match.group(0).strip().rstrip(".,;:")
            if token and token not in found:
                found.append(token)
    return found


def check_citations(
    summary: str | None,
    references: Iterable[dict[str, Any]],
) -> CitationCheck:
    """Verify every citation in `summary` traces to a retrieved reference."""
    corpus: list[str] = []
    for ref in references:
        for field in ("code", "title"):
            value = ref.get(field)
            if value:
                corpus.append(_normalize(str(value)))
    haystack = " ".join(corpus)

    supported: list[str] = []
    unsupported: list[str] = []
    for token in extract_citations(summary):
        needle = _normalize(token)
        # A citation is supported when a retrieved code contains it (the prose may
        # cite a clause more specific than the retrieved row) or vice versa.
        if needle and (
            needle in haystack or any(needle in c or c in needle for c in corpus if c)
        ):
            supported.append(token)
        else:
            unsupported.append(token)

    return CitationCheck(
        cited=tuple(supported + unsupported),
        supported=tuple(supported),
        unsupported=tuple(unsupported),
    )


@dataclass(frozen=True)
class CitationStripStats:
    """
    How often the guard had to intervene, over a set of assessments.

    This is the per-model hallucination rate the bench reports: the guard is our
    own measurement instrument, so the number is produced by the shipped code
    path rather than by a separate scoring script.
    """

    assessments: int
    assessments_with_strip: int
    cited_tokens: int
    stripped_tokens: int

    @property
    def strip_rate(self) -> float:
        """Share of assessments where at least one citation was invented."""
        return self.assessments_with_strip / self.assessments if self.assessments else 0.0

    @property
    def token_strip_rate(self) -> float:
        """Share of citation tokens that were invented."""
        return self.stripped_tokens / self.cited_tokens if self.cited_tokens else 0.0


def stripped_citations_in_trace(agent_trace: Iterable[dict[str, Any]]) -> list[str]:
    """
    Recover the citations the guard removed from a persisted agent trace.

    The orchestrator records each strip as an `error` step carrying
    `detail.unsupported_citations` (`agents/nodes/orchestrator.py`), and the trace
    is persisted to `assessment_metadata.agent_trace` — so the count is
    measurable after the fact without a new column or a second write path.
    """
    out: list[str] = []
    for step in agent_trace or []:
        if not isinstance(step, dict):
            continue
        detail = step.get("detail")
        if not isinstance(detail, dict):
            continue
        tokens = detail.get("unsupported_citations")
        if isinstance(tokens, list):
            out.extend(str(t) for t in tokens)
    return out


def supported_citations_in_trace(agent_trace: Iterable[dict[str, Any]]) -> list[str]:
    out: list[str] = []
    for step in agent_trace or []:
        if not isinstance(step, dict):
            continue
        detail = step.get("detail")
        if not isinstance(detail, dict):
            continue
        tokens = detail.get("supported_citations")
        if isinstance(tokens, list):
            out.extend(str(t) for t in tokens)
    return out


def aggregate_strip_stats(
    traces: Iterable[Iterable[dict[str, Any]]],
    *,
    summaries: Iterable[str | None] | None = None,
) -> CitationStripStats:
    """
    Aggregate strip statistics over many assessments.

    `summaries` (post-strip prose) is used to count the citations that survived,
    so `cited_tokens` covers assessments where the guard never fired and left no
    trace step at all.
    """
    trace_list = [list(t or []) for t in traces]
    summary_list = list(summaries or [])
    assessments = len(trace_list)
    with_strip = 0
    stripped = 0
    cited = 0
    for i, trace in enumerate(trace_list):
        removed = stripped_citations_in_trace(trace)
        kept = supported_citations_in_trace(trace)
        if not kept and i < len(summary_list):
            kept = extract_citations(summary_list[i])
        if removed:
            with_strip += 1
        stripped += len(removed)
        cited += len(removed) + len(kept)
    return CitationStripStats(
        assessments=assessments,
        assessments_with_strip=with_strip,
        cited_tokens=cited,
        stripped_tokens=stripped,
    )


def strip_unsupported(summary: str, unsupported: Iterable[str]) -> str:
    """
    Remove unsupported citation tokens from prose, leaving the sentence readable.

    Preferred over discarding the whole summary: the surrounding reasoning is
    usually sound and only the attribution is invented.
    """
    out = summary
    for token in unsupported:
        # Drop a trailing parenthetical/attribution wrapper along with the token.
        out = re.sub(
            r"\s*[\(\[]?\s*(?:per|under|as required by|in accordance with)?\s*"
            + re.escape(token)
            + r"\s*[\)\]]?",
            " ",
            out,
            flags=re.IGNORECASE,
        )
    return re.sub(r"\s{2,}", " ", out).replace(" ,", ",").replace(" .", ".").strip()
