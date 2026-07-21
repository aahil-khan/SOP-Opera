"""Broadcast backpressure — one slow client must not stall the others."""

from __future__ import annotations

import asyncio

import pytest

from app.realtime.connection_manager import ConnectionManager


class FakeSocket:
    """Minimal WebSocket stand-in; `gate` lets a test stall its sends."""

    def __init__(self, gate: asyncio.Event | None = None) -> None:
        self.sent: list[dict] = []
        self.accepted = False
        self.gate = gate

    async def accept(self) -> None:
        self.accepted = True

    async def send_json(self, envelope: dict) -> None:
        if self.gate is not None:
            await self.gate.wait()
        self.sent.append(envelope)


async def _settle() -> None:
    """Let writer tasks drain."""
    for _ in range(10):
        await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_broadcast_reaches_every_client():
    m = ConnectionManager()
    a, b = FakeSocket(), FakeSocket()
    await m.connect(a)
    await m.connect(b)

    await m.broadcast("review.opened", {"id": "r1"})
    await _settle()

    assert len(a.sent) == 1
    assert len(b.sent) == 1
    assert a.sent[0]["type"] == "review.opened"
    assert a.sent[0]["payload"] == {"id": "r1"}
    assert "ts" in a.sent[0]


@pytest.mark.asyncio
async def test_a_stalled_client_does_not_block_others():
    """The regression that mattered: sends were awaited in-line down a list, so
    one wedged socket blocked every client after it and the caller."""
    gate = asyncio.Event()
    slow = FakeSocket(gate=gate)
    fast = FakeSocket()

    m = ConnectionManager()
    await m.connect(slow)
    await m.connect(fast)

    for i in range(5):
        await m.broadcast("telemetry.tick", {"i": i})
    await _settle()

    assert len(fast.sent) == 5, "fast client starved by a stalled peer"
    assert slow.sent == []

    gate.set()
    await _settle()
    assert len(slow.sent) == 5


@pytest.mark.asyncio
async def test_broadcast_does_not_await_the_socket():
    """broadcast() must return promptly even when every client is stalled."""
    gate = asyncio.Event()
    m = ConnectionManager()
    await m.connect(FakeSocket(gate=gate))

    await asyncio.wait_for(m.broadcast("telemetry.tick", {"i": 0}), timeout=0.5)
    gate.set()


@pytest.mark.asyncio
async def test_wedged_client_queue_is_bounded_and_drops_oldest():
    gate = asyncio.Event()
    slow = FakeSocket(gate=gate)
    m = ConnectionManager(queue_size=4)
    await m.connect(slow)

    for i in range(50):
        await m.broadcast("telemetry.tick", {"i": i})
    await _settle()

    stats = m.stats()
    assert stats["queue_depth_max"] <= 4, "queue grew past its bound"
    assert stats["dropped_frames"] > 0, "drops not counted"

    # The frames that survive are the most recent ones — every event triggers a
    # client refetch, so a newer frame supersedes an older one.
    gate.set()
    await _settle()
    assert slow.sent, "nothing delivered after unblocking"
    assert slow.sent[-1]["payload"]["i"] == 49


@pytest.mark.asyncio
async def test_disconnect_stops_the_writer_and_frees_the_slot():
    m = ConnectionManager()
    ws = FakeSocket()
    await m.connect(ws)
    assert m.connection_count == 1

    m.disconnect(ws)
    await _settle()
    assert m.connection_count == 0

    # Broadcasting after disconnect is a no-op, not an error.
    await m.broadcast("review.opened", {"id": "r1"})
    await _settle()
    assert ws.sent == []


@pytest.mark.asyncio
async def test_a_failing_socket_is_dropped_not_retried_forever():
    class BrokenSocket(FakeSocket):
        async def send_json(self, envelope: dict) -> None:
            raise ConnectionResetError("client gone")

    m = ConnectionManager()
    broken = BrokenSocket()
    healthy = FakeSocket()
    await m.connect(broken)
    await m.connect(healthy)

    await m.broadcast("review.opened", {"id": "r1"})
    await _settle()

    assert m.connection_count == 1
    assert len(healthy.sent) == 1


@pytest.mark.asyncio
async def test_stats_shape_is_stable():
    m = ConnectionManager(queue_size=8)
    await m.connect(FakeSocket())
    stats = m.stats()
    assert stats["clients"] == 1
    assert stats["queue_capacity"] == 8
    assert stats["dropped_frames"] == 0
    assert stats["queue_depth_max"] == 0
