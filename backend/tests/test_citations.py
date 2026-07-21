"""Citation validation — a summary may only name references it retrieved."""

from __future__ import annotations

from app.assessment.citations import (
    check_citations,
    extract_citations,
    strip_unsupported,
)

REFS = [
    {"source": "regulations", "code": "Factories Act 1948 s.37(1)", "title": "Explosive or inflammable dust, gas, etc."},
    {"source": "regulations", "code": "OISD-STD-105", "title": "Work Permit System (Rev. I, September 2004)"},
    {"source": "historical_incidents", "title": "VSP-pattern near-miss"},
]


def test_extracts_indian_and_international_citation_shapes():
    found = extract_citations(
        "Per OISD-STD-105 and Factories Act 1948 s.37(1), plus OSHA-1910.146 and ISO-10816."
    )
    joined = " ".join(found)
    assert "OISD-STD-105" in joined
    assert "s.37(1)" in joined
    assert "OSHA-1910.146" in joined
    assert "ISO-10816" in joined


def test_retrieved_citations_are_supported():
    check = check_citations(
        "Hot work must stop under OISD-STD-105 and Factories Act 1948 s.37(1).",
        REFS,
    )
    assert check.ok
    assert not check.unsupported


def test_invented_clause_is_flagged():
    """The exact failure mode: a plausible clause that was never retrieved."""
    check = check_citations(
        "Blocked per OISD-STD-117 section 7.2 and DGMS Circular 2017.",
        REFS,
    )
    assert not check.ok
    assert any("117" in c for c in check.unsupported)
    assert any("DGMS" in c for c in check.unsupported)


def test_citation_matching_ignores_punctuation_and_case():
    check = check_citations("see oisd std 105 for the permit rules", REFS)
    assert check.ok


def test_no_citations_is_fine():
    check = check_citations("Gas is elevated and a worker is present.", REFS)
    assert check.ok
    assert check.cited == ()


def test_empty_summary_is_fine():
    assert check_citations(None, REFS).ok
    assert check_citations("", REFS).ok


def test_strip_removes_the_token_and_leaves_readable_prose():
    text = "Work is blocked per OISD-STD-117 because gas is elevated."
    out = strip_unsupported(text, ["OISD-STD-117"])
    assert "OISD-STD-117" not in out
    assert "gas is elevated" in out
    assert "  " not in out


def test_supported_citations_survive_stripping():
    summary = "Blocked under OISD-STD-105 and per OISD-STD-117."
    check = check_citations(summary, REFS)
    out = strip_unsupported(summary, check.unsupported)
    assert "OISD-STD-105" in out
    assert "OISD-STD-117" not in out
