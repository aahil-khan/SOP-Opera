"""Seed regulations / SOPs / incidents + knowledge_chunks embeddings (idempotent)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.assessment.embeddings import embed_texts
from app.db import vector as vector_db
from app.db.session import SessionLocal
from sqlalchemy import text

logger = logging.getLogger(__name__)

# Fixed UUIDs so deterministic retrieval tests are stable across restarts
REGULATIONS = [
    (
        "a1111111-1111-1111-1111-111111111101",
        "OSHA-1910.146",
        "Confined Space Atmospheric Testing",
        "Gas readings above action levels require evacuation and continuous monitoring before re-entry.",
        "elevated_gas",
    ),
    (
        "a1111111-1111-1111-1111-111111111102",
        "API-RP-2217",
        "Safe Work in Inert Atmospheres",
        "Hot work must not proceed when combustible gas exceeds 10% LEL without additional controls.",
        "elevated_gas",
    ),
    (
        "a1111111-1111-1111-1111-111111111103",
        "PLANT-PERMIT-01",
        "Permit to Work Conflict Rules",
        "Conflicting permits on the same asset must be suspended until the permit authority reconciles windows.",
        "permit_conflict",
    ),
    (
        "a1111111-1111-1111-1111-111111111104",
        "OSHA-1910.147",
        "Lockout/Tagout Isolation",
        "All energy sources must be isolated and verified before maintenance begins.",
        "incomplete_isolation",
    ),
    (
        "a1111111-1111-1111-1111-111111111105",
        "HR-CERT-02",
        "Worker Certification Currency",
        "Personnel with certifications expiring within the warning window must be replaced or re-certified.",
        "certification_expiring",
    ),
    (
        "a1111111-1111-1111-1111-111111111106",
        "API-STD-560",
        "Fired Heater Temperature Limits",
        "Process and utility equipment must be held below rated metal temperatures; excursions require immediate intervention.",
        "over_temperature",
    ),
    (
        "a1111111-1111-1111-1111-111111111107",
        "ISO-10816",
        "Machinery Vibration Severity",
        "Vibration above ISO band C requires diagnosis and may force a controlled shutdown.",
        "equipment_vibration_anomaly",
    ),
    (
        "a1111111-1111-1111-1111-111111111108",
        "CPCB-EFFLUENT",
        "Effluent Discharge Quality",
        "pH of treated effluent must remain within the permitted band before release.",
        "effluent_quality_breach",
    ),
    (
        "a1111111-1111-1111-1111-111111111109",
        "API-STD-2350",
        "Overfill Protection for Storage Tanks",
        "Tank levels approaching high-high or low-low setpoints require automatic and manual intervention.",
        "tank_level_critical",
    ),
    (
        "a1111111-1111-1111-1111-111111111110",
        "OSHA-1910.132",
        "Personal Protective Equipment",
        "Workers in hazard-class zones must wear the required PPE ensemble; noncompliance stops entry.",
        "ppe_noncompliance",
    ),
    (
        "a1111111-1111-1111-1111-111111111111",
        "ASME-B30",
        "Lifting Operations Coordination",
        "Overlapping lifts in the same airspace require a single lift coordinator and stop work if paths conflict.",
        "lifting_operation_conflict",
    ),
    (
        "a1111111-1111-1111-1111-111111111112",
        "NFPA-51B",
        "Hot Work Weather Hold",
        "Hot work and outdoor lifting suspend when wind or lightning exceeds site weather-hold criteria.",
        "weather_hold",
    ),
    # Indian regulatory pack — hero VSP compound-risk story (OISD / Factory Act / DGMS)
    (
        "a1111111-1111-1111-1111-111111111113",
        "OISD-GDN-116",
        "Fire Safety in Petroleum Refineries — Atmospheric Monitoring",
        "Continuous gas monitoring is mandatory in hazardous areas; work must stop when "
        "combustible or toxic gas exceeds action levels and personnel must evacuate until "
        "atmosphere is verified safe.",
        "elevated_gas",
    ),
    (
        "a1111111-1111-1111-1111-111111111114",
        "OISD-GDN-106",
        "Fire Protection Facilities — Hot Work Controls",
        "Hot work permits require verified isolation of energy sources and fire-watch "
        "arrangements; overlapping or unverified permits must be suspended before work proceeds.",
        "incomplete_isolation",
    ),
    (
        "a1111111-1111-1111-1111-111111111115",
        "Factory Act 1948 §41",
        "Hazardous Process — Occupier Safety Duties",
        "Occupiers must ensure no worker remains in a hazardous zone during abnormal process "
        "conditions; entry during elevated gas or unverified isolation is prohibited.",
        "zone_occupied",
    ),
    (
        "a1111111-1111-1111-1111-111111111116",
        "DGMS Circular 2017",
        "Gas Monitoring in Confined and Hazardous Areas",
        "Mines and heavy-industry analogues require multi-point gas detection with immediate "
        "work stoppage when readings trend toward explosive or toxic limits; isolation must "
        "be confirmed before maintenance resumes.",
        "incomplete_isolation",
    ),
    (
        "a1111111-1111-1111-1111-111111111117",
        "OISD-STD-117",
        "Permit to Work — Simultaneous Operations",
        "Permits for hot work, confined space, and adjacent process activities must be "
        "reconciled; simultaneous incompatible operations on connected equipment are prohibited.",
        "permit_conflict",
    ),
]

SOPS = [
    (
        "b2222222-2222-2222-2222-222222222201",
        "SOP-PTW-Conflict Resolution",
        "When two active permits overlap on an asset, stop work, notify the area authority, and cancel the lower-priority permit.",
        "permit_conflict",
    ),
    (
        "b2222222-2222-2222-2222-222222222202",
        "SOP-Isolation Verification",
        "Walk the isolation boundary, apply tags, and obtain a second verifier signature before issuing a hot work permit.",
        "incomplete_isolation",
    ),
    (
        "b2222222-2222-2222-2222-222222222203",
        "SOP-SIMOPS Coordination",
        "Simultaneous operations require a joint toolbox talk and a single SIMOPS coordinator before starting.",
        "simultaneous_ops",
    ),
    (
        "b2222222-2222-2222-2222-222222222204",
        "SOP-Certification Check",
        "Shift supervisors verify worker cert expiry dates at the permit board before authorizing entry.",
        "certification_expiring",
    ),
    (
        "b2222222-2222-2222-2222-222222222205",
        "SOP-Temperature Excursion Response",
        "On over-temperature alarm, reduce firing rate, notify control, and open a review before restarting production.",
        "over_temperature",
    ),
    (
        "b2222222-2222-2222-2222-222222222206",
        "SOP-Rotating Equipment Vibration",
        "Log ISO severity band, schedule balance check, and isolate if vibration persists above band C.",
        "equipment_vibration_anomaly",
    ),
    (
        "b2222222-2222-2222-2222-222222222207",
        "SOP-Effluent Guard",
        "Divert out-of-spec effluent to holding; do not discharge until lab confirms remediation.",
        "effluent_quality_breach",
    ),
    (
        "b2222222-2222-2222-2222-222222222208",
        "SOP-Tank Level Critical",
        "On high-high or low-low tank level, stop transfers and verify instrumentation before resuming.",
        "tank_level_critical",
    ),
    (
        "b2222222-2222-2222-2222-222222222209",
        "SOP-PPE Gate",
        "Refuse zone entry until PPE is compliant; record the noncompliance against the work party.",
        "ppe_noncompliance",
    ),
    (
        "b2222222-2222-2222-2222-222222222210",
        "SOP-Lift Conflict Clearance",
        "Suspend both lifts, clear the airspace, and restart under one lift plan only.",
        "lifting_operation_conflict",
    ),
    (
        "b2222222-2222-2222-2222-222222222211",
        "SOP-Weather Hold",
        "When weather hold triggers, pause hot work and outdoor lifts; resume only after all-clear from shift lead.",
        "weather_hold",
    ),
    (
        "b2222222-2222-2222-2222-222222222212",
        "SOP-OISD Coke Oven Gas Response",
        "On elevated gas in coke oven battery areas: stop hot work, confirm isolation tags, "
        "evacuate non-essential personnel, and do not re-enter until atmosphere is verified "
        "below action level — per OISD-GDN-116 and DGMS gas-monitoring guidance.",
        "elevated_gas",
    ),
    (
        "b2222222-2222-2222-2222-222222222213",
        "SOP-Factory Act Zone Clearance",
        "When gas alarms are active or isolation is unverified, clear all personnel from the "
        "hazardous zone and account for workers before authorizing any permit restart.",
        "zone_occupied",
    ),
]

INCIDENTS = [
    (
        "c3333333-3333-3333-3333-333333333301",
        "11111111-1111-1111-1111-111111111111",
        "Near-miss: workers remained in hazardous zone during gas alarm; alarm was ignored for 4 minutes.",
        "zone_occupied",
    ),
    (
        "c3333333-3333-3333-3333-333333333302",
        "22222222-2222-2222-2222-222222222222",
        "Historical incident: simultaneous crane lift and hot work caused sparks to enter live process area.",
        "simultaneous_ops",
    ),
    (
        "c3333333-3333-3333-3333-333333333303",
        "11111111-1111-1111-1111-111111111111",
        "Zone occupation during elevated H2S led to emergency MUSTER and medical observation of 2 workers.",
        "zone_occupied",
    ),
    (
        "c3333333-3333-3333-3333-333333333304",
        "77777777-7777-7777-7777-777777777702",
        "Pump house bearing failure preceded by sustained ISO band-C vibration ignored for one shift.",
        "equipment_vibration_anomaly",
    ),
    (
        "c3333333-3333-3333-3333-333333333305",
        "77777777-7777-7777-7777-777777777804",
        "Two concurrent crane lifts crossed paths; a suspended load narrowly missed a walkway canopy.",
        "lifting_operation_conflict",
    ),
    (
        "c3333333-3333-3333-3333-333333333306",
        "11111111-1111-1111-1111-111111111111",
        "VSP-pattern near-miss (seeded): elevated CO on coke oven battery coincided with active hot-work "
        "permit and incomplete isolation — pattern later echoed in Visakhapatnam Steel Plant 2025 "
        "coke oven fatality investigations where gas sensors and PTW existed but were not fused.",
        "elevated_gas",
    ),
]


async def seed_embeddings() -> None:
    async with SessionLocal() as session:
        for rid, code, title, body, cat in REGULATIONS:
            await session.execute(
                text(
                    """
                    INSERT INTO regulations (id, code, title, body_summary, applies_to_category)
                    VALUES (CAST(:id AS uuid), :code, :title, :body, :cat)
                    ON CONFLICT (id) DO UPDATE SET
                      code = EXCLUDED.code,
                      title = EXCLUDED.title,
                      body_summary = EXCLUDED.body_summary,
                      applies_to_category = EXCLUDED.applies_to_category
                    """
                ),
                {"id": rid, "code": code, "title": title, "body": body, "cat": cat},
            )

        for sid, title, body, cat in SOPS:
            await session.execute(
                text(
                    """
                    INSERT INTO sops (id, title, body_summary, applies_to_category)
                    VALUES (CAST(:id AS uuid), :title, :body, :cat)
                    ON CONFLICT (id) DO UPDATE SET
                      title = EXCLUDED.title,
                      body_summary = EXCLUDED.body_summary,
                      applies_to_category = EXCLUDED.applies_to_category
                    """
                ),
                {"id": sid, "title": title, "body": body, "cat": cat},
            )

        now = datetime.now(timezone.utc)
        for iid, asset_id, desc, cat in INCIDENTS:
            await session.execute(
                text(
                    """
                    INSERT INTO incidents (
                        id, asset_id, description, reported_at, linked_review_ids, applies_to_category
                    )
                    VALUES (
                        CAST(:id AS uuid), CAST(:asset_id AS uuid), :desc, :reported_at,
                        '{}', :cat
                    )
                    ON CONFLICT (id) DO UPDATE SET
                      description = EXCLUDED.description,
                      applies_to_category = EXCLUDED.applies_to_category
                    """
                ),
                {
                    "id": iid,
                    "asset_id": asset_id,
                    "desc": desc,
                    "reported_at": now,
                    "cat": cat,
                },
            )
        await session.commit()

    # Rebuild knowledge_chunks for our fixed source ids (idempotent)
    chunks: list[tuple[str, str, str, str]] = []
    for rid, code, title, body, cat in REGULATIONS:
        chunks.append(
            (
                "regulations",
                rid,
                f"{code}: {title}. {body}",
                cat,
            )
        )
    for sid, title, body, cat in SOPS:
        chunks.append(("sops", sid, f"{title}. {body}", cat))
    for iid, _asset, desc, cat in INCIDENTS:
        chunks.append(("historical_incidents", iid, desc, cat))

    # Deliberately no local-hash fallback here: corpus embeddings must be produced by
    # the SAME provider as query-time embeddings (app/assessment/embeddings/__init__.py),
    # otherwise cosine distances are meaningless across mismatched vector spaces. If the
    # configured provider fails, we propagate — main.py's seed_embeddings() caller
    # already catches, logs, and skips. Embed BEFORE deleting so a failed call leaves
    # any previously-seeded (valid) chunks intact instead of wiping the corpus.
    texts = [c[2] for c in chunks]
    embeddings = await embed_texts(texts)

    source_ids = [c[1] for c in chunks]
    await vector_db.execute(
        "DELETE FROM knowledge_chunks WHERE source_id = ANY($1::uuid[])",
        source_ids,
    )

    for (source_type, source_id, chunk_text, cat), emb in zip(chunks, embeddings):
        await vector_db.execute(
            """
            INSERT INTO knowledge_chunks (
                source_type, source_id, chunk_text, embedding, applies_to_category, token_count
            )
            VALUES ($1, $2::uuid, $3, $4, $5, $6)
            """,
            source_type,
            source_id,
            chunk_text,
            emb,
            cat,
            max(1, len(chunk_text.split())),
        )

    logger.info("seed_embeddings: %d knowledge chunks written", len(chunks))
