"""Unit tests for Random Mode config + signal picking (no DB)."""

from __future__ import annotations

import random

import pytest

from app.simulator.random_engine import (
    RandomModeConfig,
    SIGNAL_CATALOG,
    build_steps_for_signals,
    pick_signals,
)


def test_config_rejects_inverted_interval():
    with pytest.raises(ValueError):
        RandomModeConfig(
            spawn_interval_min_seconds=10,
            spawn_interval_max_seconds=2,
        )


def test_pick_signals_seeded_reproducible():
    cfg = RandomModeConfig(seed=42)
    a = pick_signals(random.Random(42), cfg)
    b = pick_signals(random.Random(42), cfg)
    assert a == b
    assert 1 <= len(a) <= 3
    assert all(s in SIGNAL_CATALOG for s in a)


def test_pick_signals_unseeded_can_vary():
    cfg = RandomModeConfig()
    seen: set[tuple[str, ...]] = set()
    for i in range(40):
        seen.add(tuple(pick_signals(random.Random(i), cfg)))
    assert len(seen) > 1


def test_build_steps_for_known_signals():
    steps = build_steps_for_signals(random.Random(1), ["elevated_gas", "ppe_noncompliance"])
    assert len(steps) >= 2
    cats = {s["category"] for s in steps}
    assert "sensor" in cats
    assert "ppe_status" in cats


def test_signal_catalog_covers_thirteen():
    assert len(SIGNAL_CATALOG) == 13
