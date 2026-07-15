"""Zone ownership lookup — persistent area supervisors seeded per zone."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.python.schemas import AreaOwner


def _valid_uuid_strings(worker_ids: list[str | UUID]) -> list[str]:
    out: list[str] = []
    for raw in worker_ids:
        if raw is None:
            continue
        try:
            out.append(str(UUID(str(raw))))
        except (ValueError, TypeError, AttributeError):
            continue
    return out


async def get_zone_owner(
    session: AsyncSession, zone: str
) -> AreaOwner | None:
    result = await session.execute(
        text(
            """
            SELECT zo.zone, zo.role, zo.worker_id, w.name
            FROM zone_owners zo
            JOIN workers w ON w.id = zo.worker_id
            WHERE zo.zone = :zone
            """
        ),
        {"zone": zone},
    )
    row = result.first()
    if row is None:
        return None
    m = row._mapping
    return AreaOwner(
        worker_id=m["worker_id"],
        name=m["name"],
        role=m["role"],
        zone=m["zone"],
    )


async def resolve_worker_names(
    session: AsyncSession, worker_ids: list[str | UUID]
) -> dict[str, str]:
    ids = _valid_uuid_strings(worker_ids)
    if not ids:
        return {}
    result = await session.execute(
        text(
            """
            SELECT id, name FROM workers
            WHERE id = ANY(CAST(:ids AS uuid[]))
            """
        ),
        {"ids": ids},
    )
    return {str(row._mapping["id"]): row._mapping["name"] for row in result.fetchall()}
