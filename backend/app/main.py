from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.realtime.connection_manager import manager
from shared.python.schemas import PingResponse

logger = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    from app.assessment.orchestrator import orchestrator

    try:
        from app.db.session import apply_schema
        from app.db.seed import seed_minimal
        from app.db.seed_embeddings import seed_embeddings

        await apply_schema()
        await seed_minimal()
        try:
            await seed_embeddings()
        except Exception as emb_exc:  # noqa: BLE001
            logger.warning("seed_embeddings skipped: %s", emb_exc)
        logger.info("schema applied + seed complete")
    except Exception as exc:  # noqa: BLE001 — API boots even if Postgres is down
        logger.warning("schema/seed skipped (DB unreachable?): %s", exc)

    # Start the worker regardless of bootstrap outcome: run_assessment_job() opens
    # its own session per job and the worker loop swallows per-job exceptions, so a
    # transient DB outage at boot no longer permanently strands the queue.
    worker_task = orchestrator.start()
    logger.info("assessment worker running")

    yield

    try:
        from app.db.vector import close_vector_pool

        orchestrator.stop()
        await close_vector_pool()
    except Exception:  # noqa: BLE001
        pass
    if worker_task is not None:
        worker_task.cancel()


app = FastAPI(title="SOP Opera API", version="0.4.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.context.routes import router as context_router  # noqa: E402
from app.reviews.routes import router as reviews_router  # noqa: E402
from app.decisions.routes import router as decisions_router  # noqa: E402

app.include_router(context_router)
app.include_router(reviews_router)
app.include_router(decisions_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/ping", response_model=PingResponse)
async def ping() -> PingResponse:
    return PingResponse(message="pong from sop-opera backend")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """Register for broadcasts; echo inbound text for Phase 0 /dev seam check."""
    await manager.connect(websocket)
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
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)
        raise
