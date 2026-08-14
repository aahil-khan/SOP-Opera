"""Percentile helpers — the edges that matter are zero, one and tiny samples."""

from __future__ import annotations

import pytest

from app.core.stats import LatencySummary, mean, p50, p95, percentile


def test_empty_sample_has_no_percentile():
    assert p50([]) is None
    assert p95([]) is None
    assert mean([]) is None


def test_single_sample_is_its_own_percentile():
    assert p50([420.0]) == 420.0
    assert p95([420.0]) == 420.0


def test_two_samples_interpolate():
    # p50 of [10, 20] sits halfway; p95 sits 95% of the way to the top.
    assert p50([10.0, 20.0]) == 15.0
    assert p95([10.0, 20.0]) == pytest.approx(19.5)


def test_known_sample_matches_linear_interpolation():
    data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    assert p50(data) == pytest.approx(5.5)
    assert p95(data) == pytest.approx(9.55)


def test_percentile_is_order_independent_and_ignores_none():
    assert p50([9, 1, 5, None, 3]) == p50([1, 3, 5, 9])


def test_p95_reports_the_tail_a_mean_would_hide():
    # Ninety fast calls and ten 40s outliers: the mean lands at 4.4s, which no
    # single call ever took. p50 shows the typical call, p95 shows the tail.
    data = [500.0] * 90 + [40000.0] * 10
    assert mean(data) == pytest.approx(4450.0)
    assert p50(data) == 500.0
    assert p95(data) == pytest.approx(40000.0)


def test_percentile_rejects_out_of_range_q():
    with pytest.raises(ValueError):
        percentile([1.0], 1.5)


def test_latency_summary_carries_sample_size():
    s = LatencySummary([100, 200, 300])
    assert s.count == 3
    assert s.as_dict() == {
        "count": 3,
        "mean_ms": 200.0,
        "p50_ms": 200.0,
        "p95_ms": 290.0,
    }
    empty = LatencySummary([])
    assert empty.as_dict() == {
        "count": 0,
        "mean_ms": None,
        "p50_ms": None,
        "p95_ms": None,
    }
