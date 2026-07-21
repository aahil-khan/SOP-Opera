from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)

DEFAULT_CLIENT_QUEUE_SIZE = 256
"""
Frames buffered per client before the oldest are dropped.

Sized for a client that briefly stalls (tab backgrounded, GC pause, slow link)
without letting a permanently wedged client consume unbounded memory.
"""


class _Client:
    """One connected socket plus its own outbound queue and writer task."""

    __slots__ = ("websocket", "queue", "task", "dropped")

    def __init__(self, websocket: WebSocket, maxsize: int) -> None:
        self.websocket = websocket
        self.queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=maxsize)
        self.task: asyncio.Task | None = None
        self.dropped = 0


class ConnectionManager:
    """
    Broadcast-to-all WebSocket manager (single tenant / plant).

    Each client gets a bounded queue drained by its own writer task, and
    `broadcast()` never awaits a socket. Previously `broadcast()` awaited
    `send_json` in-line down a plain list, so one slow or stalled client blocked
    every client after it *and* blocked the caller — and the caller is often the
    ingest hot path or the ambient telemetry loop, so a single wedged browser tab
    could stall plant-wide updates.

    When a client's queue is full its oldest frame is dropped rather than
    stalling the broadcaster. Dropping the oldest is right for this payload: every
    event triggers a refetch of current state on the client, so a newer frame
    supersedes an older one.
    """

    def __init__(self, *, queue_size: int = DEFAULT_CLIENT_QUEUE_SIZE) -> None:
        self._clients: dict[WebSocket, _Client] = {}
        self._queue_size = queue_size

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        client = _Client(websocket, self._queue_size)
        client.task = asyncio.create_task(self._writer(client))
        self._clients[websocket] = client

    def disconnect(self, websocket: WebSocket) -> None:
        client = self._clients.pop(websocket, None)
        if client is None:
            return
        if client.task is not None and not client.task.done():
            client.task.cancel()

    async def _writer(self, client: _Client) -> None:
        """Drain one client's queue. Owns all sends for that socket."""
        try:
            while True:
                envelope = await client.queue.get()
                await client.websocket.send_json(envelope)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — drop dead sockets
            logger.debug("ws writer stopped: %s", exc)
            self._clients.pop(client.websocket, None)

    async def broadcast(self, event_type: str, payload: dict[str, Any]) -> None:
        """
        Fan a frame out to every client without awaiting any socket.

        Kept `async` so existing call sites are unchanged, but it never blocks on
        network I/O.
        """
        envelope = {
            "type": event_type,
            "payload": payload,
            "ts": datetime.now(timezone.utc).isoformat(),
        }
        for client in list(self._clients.values()):
            self._offer(client, envelope)

    def _offer(self, client: _Client, envelope: dict[str, Any]) -> None:
        try:
            client.queue.put_nowait(envelope)
        except asyncio.QueueFull:
            # Make room by discarding the oldest frame, then enqueue. If the
            # queue drains between the get and the put we simply succeed.
            try:
                client.queue.get_nowait()
                client.dropped += 1
            except asyncio.QueueEmpty:
                pass
            try:
                client.queue.put_nowait(envelope)
            except asyncio.QueueFull:
                client.dropped += 1

    def stats(self) -> dict[str, Any]:
        """Backpressure telemetry — surfaced on the AI Ops page."""
        clients = list(self._clients.values())
        depths = [c.queue.qsize() for c in clients]
        return {
            "clients": len(clients),
            "queue_depth_max": max(depths) if depths else 0,
            "queue_depth_total": sum(depths),
            "queue_capacity": self._queue_size,
            "dropped_frames": sum(c.dropped for c in clients),
        }

    @property
    def connection_count(self) -> int:
        return len(self._clients)


manager = ConnectionManager()
