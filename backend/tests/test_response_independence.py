"""
The response layer must stay off the fact/verdict path.

If an automatic action ever wrote into the context stream, the loop would close:
action -> context entry -> derived fact -> classify() -> verdict. The
orchestrator could then suppress the hazard that triggered it — freeze a permit,
`permit_conflict` stops firing, the verdict falls to nominal, and the system
reports solving a problem it merely hid. That is the circularity already removed
from the eval harness once, and these tests exist so it cannot come back through
W1.

Pure static analysis over the source — no database required.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from app.risk.policy import ALL_RULE_FACT_TYPES, classify

RESPONSE_DIR = Path(__file__).resolve().parents[1] / "app" / "response"

FORBIDDEN_IMPORTS = {
    "app.context.derived_facts",
    "app.eval",
}


def _response_modules() -> list[Path]:
    return sorted(p for p in RESPONSE_DIR.glob("*.py"))


def test_response_package_exists() -> None:
    assert _response_modules(), "no response modules found — path drift?"


@pytest.mark.parametrize("path", _response_modules(), ids=lambda p: p.name)
def test_response_module_does_not_import_the_fact_path(path: Path) -> None:
    tree = ast.parse(path.read_text(), filename=str(path))
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module)

    for bad in FORBIDDEN_IMPORTS:
        offenders = {m for m in imported if m == bad or m.startswith(bad + ".")}
        assert not offenders, (
            f"{path.name} imports {offenders} — the response layer must not "
            "reach into the fact/verdict path"
        )


@pytest.mark.parametrize("path", _response_modules(), ids=lambda p: p.name)
def test_response_module_never_writes_context_or_facts(path: Path) -> None:
    """
    No response module may INSERT/UPDATE/DELETE the tables the verdict is
    computed from. Checked as text because the SQL is raw `text()`.
    """
    source = path.read_text().lower()
    for table in ("context_entries", "derived_facts"):
        for verb in ("insert into", "update", "delete from"):
            needle = f"{verb} {table}"
            assert needle not in source, (
                f"{path.name} contains {needle!r} — response actions must never "
                "write into the fact stream"
            )


def test_classify_is_unaffected_by_response_state() -> None:
    """
    The verdict is a function of facts alone.

    Importing and exercising the response layer must not change what `classify()`
    returns for the same facts — there is no shared mutable state between them.
    """
    facts = ["elevated_gas", "incomplete_isolation", "zone_occupied"]
    before = classify(facts)

    import app.response.envelope as envelope
    import app.response.service as response_service

    # Touch the module surface the pipeline actually uses.
    assert response_service.tiers_for("blocking", has_facts=True) == [0, 1, 2]
    assert envelope.ACTION_REGISTRY

    after = classify(facts)
    assert after == before


def test_no_response_action_kind_collides_with_a_fact_type() -> None:
    """
    Action kinds and fact types share a namespace in the UI and the report. A
    collision would make an automatic action look like a detected fact.
    """
    from app.response.envelope import ACTION_REGISTRY

    overlap = set(ACTION_REGISTRY) & set(ALL_RULE_FACT_TYPES)
    assert not overlap, f"action kinds collide with fact types: {overlap}"


def test_tier_mapping_is_cumulative_and_verdict_driven() -> None:
    from app.response.service import tiers_for

    assert tiers_for("nominal", has_facts=False) == []
    # A nominal verdict with facts still preserves evidence, and nothing else.
    assert tiers_for("nominal", has_facts=True) == [0]
    assert tiers_for("elevated", has_facts=True) == [0, 1]
    assert tiers_for("blocking", has_facts=True) == [0, 1, 2]
