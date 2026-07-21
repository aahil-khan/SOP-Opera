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
from dataclasses import dataclass
from typing import Any, Iterable

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
