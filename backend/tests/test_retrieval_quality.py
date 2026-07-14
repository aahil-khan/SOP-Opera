from __future__ import annotations

from uuid import uuid4

from shared.python.schemas import RetrievedReference

from app.assessment.retrieval import assess_retrieval_quality


def _ref(score: float | None) -> RetrievedReference:
    return RetrievedReference(
        source="regulations",
        id=uuid4(),
        retrieval_path="rag",
        score=score,
        chunk_id=uuid4(),
    )


def test_quality_empty_no_refs():
    assert assess_retrieval_quality([], score_threshold=0.72) == "empty"


def test_quality_good_meets_threshold():
    refs = [_ref(0.9), _ref(0.8)]
    assert assess_retrieval_quality(refs, score_threshold=0.72, min_chunks=1) == "good"
    assert assess_retrieval_quality(refs, score_threshold=0.72, min_chunks=2) == "good"


def test_quality_weak_below_threshold():
    refs = [_ref(0.5), _ref(0.4)]
    assert assess_retrieval_quality(refs, score_threshold=0.72) == "weak"


def test_quality_weak_when_not_enough_strong():
    refs = [_ref(0.9), _ref(0.4)]
    assert (
        assess_retrieval_quality(refs, score_threshold=0.72, min_chunks=2) == "weak"
    )


def test_quality_none_scores_are_weak_not_good():
    refs = [_ref(None), _ref(None)]
    assert assess_retrieval_quality(refs, score_threshold=0.72) == "weak"
