"""ContextProvider protocol — shared seam for Manual, Simulator, and Webhook adapters."""

from __future__ import annotations

from typing import Protocol

from app.context.schemas import ContextIn, ContextIngestResult


class ContextProvider(Protocol):
    """
    All plant context enters through emit() → ingest_context().

    Manual REST, scenario simulator, and external SCADA webhooks implement this
    so the twin / review path stays identical regardless of source.
    """

    async def emit(self, context: ContextIn) -> ContextIngestResult: ...
