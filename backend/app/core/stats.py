"""
Small, dependency-free summary statistics shared by AI Ops and the model bench.

Latency was previously reported as a mean only. A mean hides the shape a control
room actually cares about: one 40-second generation inside twenty fast ones moves
the mean by two seconds and is invisible, while p95 states it plainly. Both are
reported — the mean stays, the percentiles are added beside it.

`percentile()` uses linear interpolation between order statistics (the same
definition as numpy's default and Postgres `percentile_cont`), so a small sample
degrades sensibly rather than snapping to a single observation.
"""

from __future__ import annotations

from typing import Iterable, Sequence


def percentile(values: Sequence[float] | Iterable[float], q: float) -> float | None:
    """
    Linear-interpolated percentile. `q` is a fraction in [0, 1].

    Returns None for an empty sample — there is no honest number to report, and
    a caller rendering `None` as "—" beats one rendering 0.0 as a measurement.
    A single sample is its own percentile at every q.
    """
    if not 0.0 <= q <= 1.0:
        raise ValueError("q must be between 0 and 1")
    data = sorted(float(v) for v in values if v is not None)
    if not data:
        return None
    if len(data) == 1:
        return data[0]
    pos = q * (len(data) - 1)
    low = int(pos)
    high = min(low + 1, len(data) - 1)
    frac = pos - low
    return data[low] + (data[high] - data[low]) * frac


def p50(values: Sequence[float] | Iterable[float]) -> float | None:
    """Median — the typical case."""
    return percentile(values, 0.50)


def p95(values: Sequence[float] | Iterable[float]) -> float | None:
    """Tail — the slowest 1 in 20, which is what a control room feels as "stuck"."""
    return percentile(values, 0.95)


def mean(values: Sequence[float] | Iterable[float]) -> float | None:
    data = [float(v) for v in values if v is not None]
    if not data:
        return None
    return sum(data) / len(data)


class LatencySummary:
    """mean / p50 / p95 over one sample, with the sample size carried alongside."""

    __slots__ = ("count", "mean_ms", "p50_ms", "p95_ms")

    def __init__(self, values: Sequence[float] | Iterable[float]) -> None:
        data = [float(v) for v in values if v is not None]
        self.count = len(data)
        self.mean_ms = mean(data)
        self.p50_ms = p50(data)
        self.p95_ms = p95(data)

    def as_dict(self) -> dict[str, float | int | None]:
        return {
            "count": self.count,
            "mean_ms": None if self.mean_ms is None else round(self.mean_ms, 2),
            "p50_ms": None if self.p50_ms is None else round(self.p50_ms, 2),
            "p95_ms": None if self.p95_ms is None else round(self.p95_ms, 2),
        }
