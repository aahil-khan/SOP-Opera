from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Broadcast-to-all WebSocket manager (single tenant / plant)."""

    def __init__(self) -> None:
        self._connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self._connections:
            self._connections.remove(websocket)

    async def broadcast(self, event_type: str, payload: dict[str, Any]) -> None:
        envelope = {
            "type": event_type,
            "payload": payload,
            "ts": datetime.now(timezone.utc).isoformat(),
        }
        dead: list[WebSocket] = []
        for ws in list(self._connections):
            try:
                await ws.send_json(envelope)
            except Exception as exc:  # noqa: BLE001 — drop dead sockets
                logger.debug("ws broadcast failed: %s", exc)
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()
