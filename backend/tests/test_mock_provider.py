from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest

from app.assessment.providers.mock import MockProvider, COMPOUND_TRIO
from app.assessment.schemas import AssessmentResult
from shared.python.schemas import DerivedFact, RetrievedReference


def _fact(fact_type: str) -> DerivedFact:
    return DerivedFact(
        id=uuid4(),
        asset_id=UUID("11111111-1111-1111-1111-111111111111"),
        fact_type=fact_type,
        value=True,
        computed_at=datetime.now(timezone.utc),
        source_context_ids=[],
    )


@pytest.mark.asyncio
async def test_mock_single_fact_elevated():
    gen = await MockProvider().generate_assessment(
        [_fact("elevated_gas")],
        [],
        None,
    )
    result = AssessmentResult.model_validate(gen.result.model_dump())
    assert result.risk_level == "elevated"
    assert len(result.recommendations) == 1
    assert "elevated_gas" in result.summary
    assert gen.provider == "mock"


@pytest.mark.asyncio
async def test_mock_compound_trio_blocking():
    facts = [_fact(ft) for ft in sorted(COMPOUND_TRIO)]
    refs = [
        RetrievedReference(
            source="regulations",
            id=uuid4(),
            retrieval_path="deterministic",
        )
    ]
    gen = await MockProvider().generate_assessment(facts, [uuid4()], refs)
    assert gen.result.risk_level == "blocking"
    assert len(gen.result.recommendations) == 3


@pytest.mark.asyncio
async def test_mock_no_facts_nominal():
    gen = await MockProvider().generate_assessment([], [], [])
    assert gen.result.risk_level == "nominal"
    assert len(gen.result.recommendations) >= 1
