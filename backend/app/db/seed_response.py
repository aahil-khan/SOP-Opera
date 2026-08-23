"""
Seed the response device registry and the paging directory.

Both are reference data: a demo reset clears actions and pages but leaves these,
the same way it leaves assets and workers. `reset_device_states()` returns
devices to their default state so a run never starts mid-incident.

Everything here is **simulated and marked as such** in the rows themselves, so
the in-product label is driven by data rather than a hardcoded string. The
contact numbers are deliberately, obviously fictional.

Until Track C's `docs/finals/response-directory.md` lands, the first escalation
step is backfilled from `zone_owners` — the plant already knows who owns each
area, so paging starts from real ownership rather than an invented org chart.
"""

from __future__ import annotations

import logging

from sqlalchemy import text

from app.db.seed import ASSETS
from app.db.session import SessionLocal

logger = logging.getLogger(__name__)

# kind -> (label suffix, default_state, fail_safe_state)
#
# `fail_safe_state` is where the device lands on loss of control, which is not
# always its default: a tool gate normally sits open but fails closed, and
# exclusion signage fails lit. Revocation reverts to `default_state` instead —
# see revoke_action().
DEVICE_KINDS: list[tuple[str, str, str, str]] = [
    ("ventilation", "Ventilation", "off", "off"),
    ("pa_zone", "PA zone", "idle", "idle"),
    ("exclusion_signage", "Exclusion signage", "clear", "lit"),
    ("tool_issuance_gate", "Tool issuance gate", "open", "closed"),
    ("muster_alarm", "Muster alarm", "silent", "silent"),
    ("permit_gate", "Permit gate", "open", "frozen"),
]

# Escalation steps 2 and 3 are plant-wide roles rather than per-zone owners.
# Order 1 comes from zone_owners.
FALLBACK_CONTACTS: list[tuple[int, str, str]] = [
    (2, "Shift Fire Marshal", "+91-99000-00002"),
    (3, "Plant Safety Head", "+91-99000-00003"),
]


def _zones() -> list[str]:
    return sorted({zone for _, _, zone, _, _ in ASSETS})


async def seed_response() -> None:
    async with SessionLocal() as session:
        zones = _zones()

        for zone in zones:
            for kind, label, default_state, fail_safe in DEVICE_KINDS:
                await session.execute(
                    text(
                        """
                        INSERT INTO response_devices (
                            zone, kind, label, state, default_state,
                            fail_safe_state, reversible, controllable, simulated
                        )
                        VALUES (
                            :zone, :kind, :label, :default_state, :default_state,
                            :fail_safe, TRUE, TRUE, TRUE
                        )
                        ON CONFLICT (zone, kind) DO UPDATE
                          SET label = EXCLUDED.label,
                              default_state = EXCLUDED.default_state,
                              fail_safe_state = EXCLUDED.fail_safe_state
                        """
                    ),
                    {
                        "zone": zone,
                        "kind": kind,
                        "label": f"{label} · {zone}",
                        "default_state": default_state,
                        "fail_safe": fail_safe,
                    },
                )

            # Step 1: the area owner the plant already recognises.
            await session.execute(
                text(
                    """
                    INSERT INTO response_contacts (
                        role, zone, contact, escalation_order, worker_id, simulated
                    )
                    SELECT zo.role, zo.zone, '+91-99000-00001', 1, zo.worker_id, TRUE
                    FROM zone_owners zo
                    WHERE zo.zone = :zone
                    ON CONFLICT (zone, escalation_order) DO UPDATE
                      SET role = EXCLUDED.role,
                          worker_id = EXCLUDED.worker_id
                    """
                ),
                {"zone": zone},
            )

            for order, role, contact in FALLBACK_CONTACTS:
                await session.execute(
                    text(
                        """
                        INSERT INTO response_contacts (
                            role, zone, contact, escalation_order, simulated
                        )
                        VALUES (:role, :zone, :contact, :order, TRUE)
                        ON CONFLICT (zone, escalation_order) DO UPDATE
                          SET role = EXCLUDED.role, contact = EXCLUDED.contact
                        """
                    ),
                    {
                        "role": role,
                        "zone": zone,
                        "contact": contact,
                        "order": order,
                    },
                )

        await session.commit()
        logger.info(
            "seed_response: %d zones × %d devices + escalation chains seeded",
            len(zones),
            len(DEVICE_KINDS),
        )
