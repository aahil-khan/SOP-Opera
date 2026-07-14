from __future__ import annotations

from app.context.schemas import ContextIn, ContextIngestResult
from app.context.service import ingest_context


class ManualInputProvider:
    """Thin REST-backed ContextProvider (TDS §5.2)."""

    def __init__(self, session) -> None:  # AsyncSession
        self._session = session

    async def emit(self, context: ContextIn) -> ContextIngestResult:
        return await ingest_context(self._session, context)
