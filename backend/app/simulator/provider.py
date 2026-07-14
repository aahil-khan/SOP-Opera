"""SimulatorProvider — ContextProvider that feeds the same ingest_context() as Manual Input."""

from __future__ import annotations

from app.context.schemas import ContextIn, ContextIngestResult
from app.context.service import ingest_context


class SimulatorProvider:
    """In-process ContextProvider for scenario replay (TDS §5.2)."""

    def __init__(self, session) -> None:  # AsyncSession
        self._session = session

    async def emit(self, context: ContextIn) -> ContextIngestResult:
        return await ingest_context(self._session, context)
