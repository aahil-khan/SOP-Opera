"""
Regulatory coverage — how often an assessment cites the provision that applies.

"Regulatory compliance coverage (OISD / Factories Act)" was the only scored claim
with no number behind it. Compound-risk accuracy and lead time both had harnesses;
compliance had a seeded corpus and an assertion.

This measures, over the eval dataset: for each case where a statutory stop-work
provision applies, does deterministic retrieval surface a reference for the facts
that case triggers? It scores the retrieval *rules*, not a live database, so it
runs offline alongside the rest of the harness.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.assessment.retrieval.deterministic import RETRIEVAL_RULES
from app.db.seed_embeddings import INDIAN_REGULATIONS, REGULATIONS
from app.eval.dataset import EvalCase, build_dataset
from app.eval.detectors import active_fact_types

# Fact types that at least one statutory provision in the corpus speaks to.
STATUTORY_FACT_COVERAGE: dict[str, list[str]] = {}
for _rid, _code, _title, _body, _cat, _clause, _url in INDIAN_REGULATIONS:
    STATUTORY_FACT_COVERAGE.setdefault(_cat, []).append(f"{_code} {_clause}")

# Every fact type the deterministic retriever can return a regulation for.
REGULATION_FACT_TYPES: frozenset[str] = frozenset(
    ft for ft, sources in RETRIEVAL_RULES.items() if "regulations" in sources
)

CORPUS_CATEGORIES: frozenset[str] = frozenset(
    cat for *_rest, cat in ((r[0], r[1], r[2], r[3], r[4]) for r in REGULATIONS)
)


@dataclass(frozen=True)
class CoverageReport:
    case_count: int
    cases_with_facts: int
    cases_with_regulation: int
    cases_with_statutory_citation: int
    per_standard: dict[str, int]
    uncovered_fact_types: tuple[str, ...]

    @property
    def regulation_coverage_pct(self) -> float:
        if not self.cases_with_facts:
            return 0.0
        return self.cases_with_regulation / self.cases_with_facts * 100.0

    @property
    def statutory_coverage_pct(self) -> float:
        if not self.cases_with_facts:
            return 0.0
        return self.cases_with_statutory_citation / self.cases_with_facts * 100.0


def _standard_family(code: str) -> str:
    if code.startswith("Factories Act"):
        return "Factories Act 1948"
    if code.startswith("OISD"):
        return "OISD"
    return "Other / international"


def compute_coverage(cases: list[EvalCase] | None = None) -> CoverageReport:
    cases = cases or build_dataset()

    with_facts = 0
    with_regulation = 0
    with_statutory = 0
    per_standard: dict[str, int] = {}
    uncovered: set[str] = set()

    for case in cases:
        facts = active_fact_types(list(case.entries)) - {"spatial_cooccurrence"}
        if not facts:
            continue
        with_facts += 1

        reg_facts = facts & REGULATION_FACT_TYPES
        if reg_facts:
            with_regulation += 1
        else:
            uncovered |= facts

        statutory_hits = {
            code
            for ft in facts
            for code in STATUTORY_FACT_COVERAGE.get(ft, [])
        }
        if statutory_hits:
            with_statutory += 1
        for code in statutory_hits:
            family = _standard_family(code)
            per_standard[family] = per_standard.get(family, 0) + 1

    return CoverageReport(
        case_count=len(cases),
        cases_with_facts=with_facts,
        cases_with_regulation=with_regulation,
        cases_with_statutory_citation=with_statutory,
        per_standard=dict(sorted(per_standard.items())),
        uncovered_fact_types=tuple(sorted(uncovered)),
    )
