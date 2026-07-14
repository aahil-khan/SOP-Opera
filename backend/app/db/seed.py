"""Seed skeleton — Phase 0. Fills minimal demo rows when DB is available.

Full plant/regulations/embeddings seeding lands in later phases.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


async def seed_minimal() -> None:
    """Placeholder: call after apply_schema() in later phases with real UPSERTs."""
    logger.info("seed_minimal: no-op skeleton (Phase 0)")
