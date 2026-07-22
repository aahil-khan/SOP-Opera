from __future__ import annotations

import json
from typing import Any
from urllib.parse import quote, unquote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.schemas import ActorMeOut, LoginIn, RosterEntryOut
from app.db.session import get_session

router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE_KEY = "sop_actor"
ACTOR_HEADER_KEY = "X-SOP-Actor"


def _encode_actor_cookie(actor: dict[str, Any]) -> str:
    raw = json.dumps(actor, separators=(",", ":"))
    return quote(raw, safe="")


def _decode_actor_cookie(value: str | None) -> dict[str, Any] | None:
    if not value:
        return None
    try:
        raw = unquote(value)
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            return None
        return parsed
    except Exception:
        return None


def _coerce_actor_me(parsed: dict[str, Any] | None) -> ActorMeOut | None:
    if not parsed:
        return None
    try:
        # Let Pydantic validate UUIDs/literals.
        return ActorMeOut(**parsed)
    except Exception:
        return None


def get_current_actor_from_request(request: Request) -> ActorMeOut | None:
    parsed = _decode_actor_cookie(request.cookies.get(COOKIE_KEY))
    actor = _coerce_actor_me(parsed)
    if actor is not None:
        return actor
    # Dev UI mirrors sop_actor on the page origin; forward it when the API cookie
    # is not sent cross-origin (localhost:3000 → 127.0.0.1:8000).
    header_val = request.headers.get(ACTOR_HEADER_KEY)
    if header_val:
        parsed_header = _decode_actor_cookie(header_val)
        return _coerce_actor_me(parsed_header)
    return None


def get_current_actor(request: Request) -> ActorMeOut:
    actor = get_current_actor_from_request(request)
    if actor is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return actor


@router.get("/me", response_model=ActorMeOut)
async def me(request: Request) -> ActorMeOut:
    actor = get_current_actor_from_request(request)
    if actor is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return actor


@router.get("/roster", response_model=list[RosterEntryOut])
async def roster(session: AsyncSession = Depends(get_session)) -> list[RosterEntryOut]:
    # Operator users (currently 1 seeded row) + worker supervisors.
    users_res = await session.execute(
        text("SELECT id, name, role FROM users")
    )
    users = [
        dict(row._mapping) for row in users_res.fetchall()
    ]

    workers_res = await session.execute(
        text("SELECT id, name FROM workers")
    )
    workers = [dict(row._mapping) for row in workers_res.fetchall()]

    out: list[RosterEntryOut] = []

    for u in users:
        out.append(
            RosterEntryOut(
                id=u["id"],
                kind="user",
                name=u["name"],
                role=u["role"],
                owned_zones=[],
            )
        )

    for w in workers:
        zones_res = await session.execute(
            text(
                """
                SELECT zone, role
                FROM zone_owners
                WHERE worker_id = CAST(:wid AS uuid)
                ORDER BY zone
                """
            ),
            {"wid": str(w["id"])},
        )
        rows = zones_res.fetchall()
        owned_zones = [str(r._mapping["zone"]) for r in rows]
        roles = sorted({str(r._mapping["role"]) for r in rows if r._mapping.get("role")})
        role = roles[0] if roles else "Area Supervisor"

        out.append(
            RosterEntryOut(
                id=w["id"],
                kind="worker",
                name=w["name"],
                role=role,
                owned_zones=owned_zones,
            )
        )

    # Stable ordering for UI: operator first, then workers by name.
    def sort_key(e: RosterEntryOut) -> tuple[int, str]:
        return (0 if e.kind == "user" else 1, e.name)

    return sorted(out, key=sort_key)


@router.post("/login")
async def login(
    body: LoginIn,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    actor_id: UUID = body.actor_id

    user_res = await session.execute(
        text("SELECT id, name, role FROM users WHERE id = CAST(:id AS uuid)"),
        {"id": str(actor_id)},
    )
    user_row = user_res.first()

    if user_row is not None:
        m = user_row._mapping
        actor_cookie = {
            "id": str(m["id"]),
            "kind": "user",
            "name": m["name"],
            "role": m["role"],
            "owned_zones": [],
        }
        response.set_cookie(
            key=COOKIE_KEY,
            value=_encode_actor_cookie(actor_cookie),
            httponly=False,
            samesite="lax",
        )
        return {"status": "ok"}

    worker_res = await session.execute(
        text("SELECT id, name FROM workers WHERE id = CAST(:id AS uuid)"),
        {"id": str(actor_id)},
    )
    worker_row = worker_res.first()
    if worker_row is None:
        raise HTTPException(status_code=404, detail="Unknown actor id")

    w = worker_row._mapping
    zones_res = await session.execute(
        text("SELECT zone, role FROM zone_owners WHERE worker_id = CAST(:id AS uuid) ORDER BY zone"),
        {"id": str(actor_id)},
    )
    rows = zones_res.fetchall()
    owned_zones = [str(r._mapping["zone"]) for r in rows]
    roles = sorted({str(r._mapping["role"]) for r in rows if r._mapping.get("role")})
    role = roles[0] if roles else "Area Supervisor"

    actor_cookie = {
        "id": str(w["id"]),
        "kind": "worker",
        "name": w["name"],
        "role": role,
        "owned_zones": owned_zones,
    }
    response.set_cookie(
        key=COOKIE_KEY,
        value=_encode_actor_cookie(actor_cookie),
        httponly=False,
        samesite="lax",
    )
    return {"status": "ok"}


@router.post("/logout")
async def logout(response: Response) -> dict[str, str]:
    response.delete_cookie(key=COOKIE_KEY, path="/", samesite="lax")
    return {"status": "ok"}

