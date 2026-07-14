from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from shared.python.schemas import PingResponse

logger = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        from app.db.session import apply_schema
        from app.db.seed import seed_minimal

        await apply_schema()
        await seed_minimal()
        logger.info("schema applied")
    except Exception as exc:  # noqa: BLE001 — Phase 0: API boots even if Postgres is down
        logger.warning("schema/seed skipped (DB unreachable?): %s", exc)
    yield


app = FastAPI(title="SOP Opera API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/ping", response_model=PingResponse)
async def ping() -> PingResponse:
    """Phase 0 dummy REST endpoint — Next.js polls this to prove the seam."""
    return PingResponse(message="pong from sop-opera backend")


@app.websocket("/ws")
async def websocket_echo(websocket: WebSocket) -> None:
    """Phase 0 WebSocket echo — frontend proves live channel."""
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            await websocket.send_json(
                {
                    "type": "echo",
                    "payload": {"echo": data},
                    "ts": datetime.now(timezone.utc).isoformat(),
                }
            )
    except WebSocketDisconnect:
        return
