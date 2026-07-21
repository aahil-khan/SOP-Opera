"""Assessment pipeline execution — retrieve → generate → validate/retry → persist."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.graph import run_agent_assessment
from app.handover.repository import fetch_unacknowledged_for_asset
from app.agents.routing import should_load_plant_neighborhood
from app.ai_ops.events import record_ai_ops_event
from app.assessment.orchestrator import PROMPT_VERSION
from app.assessment.reasoning import (
    build_reasoning_factors,
    format_predicted_trend_detail,
    serialize_factor,
)
from app.assessment.retrieval import build_retrieval_query, retrieve
from app.assessment.retrieval.enrich import enrich_references, serialize_ref
from app.context.derived_facts import load_valid_context, load_valid_context_for_assets
from app.core.config import get_settings
from app.db.session import SessionLocal
from app.graph.kg import neighbors_within_radius, get_plant_graph
from app.realtime.connection_manager import manager
from app.reviews.ownership import get_zone_owner, resolve_worker_names
from app.reviews.repository import get_review, transition_review
from app.reviews.state_machine import IllegalTransitionError, ReviewEvent
from shared.python.schemas import DerivedFact, ReasoningFactor, RetrievedReference

logger = logging.getLogger(__name__)


def _classify_failure(exc: Exception | None) -> str:
    if isinstance(exc, ValidationError):
        return "validation"
    # Walk cause/context chain for wrapped ValidationError.
    cursor: BaseException | None = exc
    seen: set[int] = set()
    while cursor is not None and id(cursor) not in seen:
        seen.add(id(cursor))
        if isinstance(cursor, ValidationError):
            return "validation"
        cursor = cursor.__cause__ or cursor.__context__
    return "provider_error"


def _serialize_refs(refs: list[RetrievedReference]) -> list[dict]:
    return [serialize_ref(r) for r in refs]


def _serialize_factors(factors: list) -> list[dict]:
    return [serialize_factor(f) for f in factors]


def _trend_forecasts_from_trace(agent_trace: list[dict]) -> list[dict[str, Any]]:
    """Prefer orchestrator verdict forecasts; fall back to predictive-trend agent detail."""
    verdict_forecasts: list[dict[str, Any]] = []
    agent_forecasts: list[dict[str, Any]] = []
    for step in agent_trace:
        if not isinstance(step, dict):
            continue
        detail = step.get("detail") or {}
        if not isinstance(detail, dict):
            continue
        raw = detail.get("forecasts") or detail.get("trend_forecasts")
        if not isinstance(raw, list):
            continue
        cleaned = [f for f in raw if isinstance(f, dict)]
        if not cleaned:
            continue
        if step.get("agent") == "orchestrator" and step.get("kind") == "verdict":
            verdict_forecasts = cleaned
        elif step.get("agent") == "predictive_trend":
            agent_forecasts = cleaned
    return verdict_forecasts or agent_forecasts


def _augment_reasoning_with_predictive_trend(
    *,
    reasoning_factors: list[ReasoningFactor],
    agent_trace: list[dict],
    asset_name: str,
    settings: Any,
) -> list[ReasoningFactor]:
    """
    Persist a deterministic Why-factor for predicted_trend_risk.

    The forecast is computed inside the LangGraph run, so it isn't present in
    DB-derived facts loaded by _load_true_facts().
    """

    try:
        if any(f.fact_type == "predicted_trend_risk" for f in reasoning_factors):
            return reasoning_factors

        predictive_hit = any(
            isinstance(s, dict)
            and s.get("agent") == "predictive_trend"
            and s.get("kind") == "observation"
            and s.get("finding") == "risk"
            for s in agent_trace
        )
        if not predictive_hit:
            return reasoning_factors

        horizon_seconds = max(
            0.0, float(settings.predictive_trend_horizon_minutes) * 60.0
        )
        min_r2 = float(settings.predictive_trend_min_r2)
        trend_forecasts = _trend_forecasts_from_trace(agent_trace)

        candidates: list[tuple[float, dict[str, Any]]] = []
        for f in trend_forecasts:
            metric = f.get("metric")
            r2 = f.get("r_squared")
            slope = f.get("slope_per_min")
            eta_elev = f.get("seconds_to_elevated")
            eta_crit = f.get("seconds_to_critical")

            if not isinstance(metric, str):
                continue
            if not isinstance(slope, (int, float)):
                continue
            if not isinstance(r2, (int, float)) or float(r2) < min_r2:
                continue

            sort_key: float | None = None
            if isinstance(eta_crit, (int, float)) and 0.0 <= float(eta_crit) <= horizon_seconds:
                sort_key = float(eta_crit)
            elif isinstance(eta_elev, (int, float)) and 0.0 <= float(eta_elev) <= horizon_seconds:
                sort_key = float(eta_elev) + 1e6

            if sort_key is not None:
                candidates.append((sort_key, f))

        if candidates:
            top = sorted(candidates, key=lambda item: item[0])[0][1]
            reasoning_factors.append(
                ReasoningFactor(
                    fact_type="predicted_trend_risk",
                    headline="Rising sensor trend",
                    detail=format_predicted_trend_detail(
                        asset_name=asset_name,
                        metric=str(top.get("metric") or ""),
                        slope_per_min=float(top.get("slope_per_min") or 0.0),
                        r_squared=float(top.get("r_squared") or 0.0),
                        seconds_to_elevated=(
                            float(top["seconds_to_elevated"])
                            if top.get("seconds_to_elevated") is not None
                            else None
                        ),
                        seconds_to_critical=(
                            float(top["seconds_to_critical"])
                            if top.get("seconds_to_critical") is not None
                            else None
                        ),
                    ),
                )
            )
            return reasoning_factors

        # Sparse-data fallback: elevated gas + hot work without OLS confidence yet.
        reasoning_factors.append(
            ReasoningFactor(
                fact_type="predicted_trend_risk",
                headline="Rising sensor trend",
                detail=(
                    f"Elevated gas with active hot work on {asset_name} — "
                    "anticipatory forecast flagged before regression confirms trajectory."
                ),
            )
        )
        return reasoning_factors
    except Exception:  # noqa: BLE001
        logger.debug("augment predictive trend reasoning failed", exc_info=True)
        return reasoning_factors


async def _load_true_facts(
    session: AsyncSession, asset_id: UUID
) -> list[DerivedFact]:
    result = await session.execute(
        text(
            """
            SELECT DISTINCT ON (fact_type)
                id, asset_id, fact_type, value, computed_at, source_context_ids
            FROM derived_facts
            WHERE asset_id = CAST(:asset_id AS uuid)
            ORDER BY fact_type, computed_at DESC
            """
        ),
        {"asset_id": str(asset_id)},
    )
    facts: list[DerivedFact] = []
    for row in result.fetchall():
        m = row._mapping
        value = m["value"]
        if isinstance(value, dict):
            value = value.get("value", value)
        if not (value is True or value == "true"):
            continue
        facts.append(
            DerivedFact(
                id=m["id"],
                asset_id=m["asset_id"],
                fact_type=m["fact_type"],
                value=True,
                computed_at=m["computed_at"],
                source_context_ids=list(m["source_context_ids"] or []),
            )
        )
    return facts


async def _load_asset(session: AsyncSession, asset_id: UUID) -> tuple[str, str]:
    result = await session.execute(
        text("SELECT name, zone FROM assets WHERE id = CAST(:id AS uuid)"),
        {"id": str(asset_id)},
    )
    row = result.first()
    if row is None:
        return ("unknown", "unknown")
    return (row._mapping["name"], row._mapping["zone"])


async def _context_ids(session: AsyncSession, asset_id: UUID) -> list[UUID]:
    result = await session.execute(
        text(
            """
            SELECT id FROM context_entries
            WHERE asset_id = CAST(:asset_id AS uuid)
              AND valid_from <= now()
              AND valid_until > now()
            ORDER BY valid_from DESC
            LIMIT 50
            """
        ),
        {"asset_id": str(asset_id)},
    )
    return [row._mapping["id"] for row in result.fetchall()]


async def _persist_metadata(
    session: AsyncSession,
    assessment_id: UUID,
    *,
    review_id: UUID,
    status: str,
    provider: str,
    model: str,
    tokens_in: int,
    tokens_out: int,
    cost_usd: float,
    latency_ms: int,
    confidence: float,
    context_ids: list[UUID],
    evidence_ids: list[UUID],
    retrieved_references: list[RetrievedReference],
    retrieval_mode: str,
    retrieval_quality: str,
    retrieval_score: float | None,
    embedding_model: str | None,
    failure_reason: str | None = None,
    reasoning_factors: list | None = None,
    agent_trace: list | None = None,
    llm_attempt_count: int = 0,
    llm_fallback_count: int = 0,
    degraded: bool = False,
) -> None:
    await session.execute(
        text(
            """
            INSERT INTO assessment_metadata (
                assessment_id, provider, model, prompt_version,
                tokens_in, tokens_out, cost_usd, latency_ms, confidence,
                retrieved_context_ids, retrieved_evidence_ids, retrieved_references,
                retrieval_mode, retrieval_quality, retrieval_score, embedding_model,
                failure_reason, reasoning_factors, agent_trace
            )
            VALUES (
                CAST(:aid AS uuid), :provider, :model, :prompt_version,
                :tokens_in, :tokens_out, :cost_usd, :latency_ms, :confidence,
                CAST(:ctx AS uuid[]), CAST(:ev AS uuid[]), CAST(:refs AS jsonb),
                :retrieval_mode, :retrieval_quality, :retrieval_score, :embedding_model,
                :failure_reason, CAST(:factors AS jsonb), CAST(:agent_trace AS jsonb)
            )
            ON CONFLICT (assessment_id) DO UPDATE SET
                provider = EXCLUDED.provider,
                model = EXCLUDED.model,
                prompt_version = EXCLUDED.prompt_version,
                tokens_in = EXCLUDED.tokens_in,
                tokens_out = EXCLUDED.tokens_out,
                cost_usd = EXCLUDED.cost_usd,
                latency_ms = EXCLUDED.latency_ms,
                confidence = EXCLUDED.confidence,
                retrieved_context_ids = EXCLUDED.retrieved_context_ids,
                retrieved_evidence_ids = EXCLUDED.retrieved_evidence_ids,
                retrieved_references = EXCLUDED.retrieved_references,
                retrieval_mode = EXCLUDED.retrieval_mode,
                retrieval_quality = EXCLUDED.retrieval_quality,
                retrieval_score = EXCLUDED.retrieval_score,
                embedding_model = EXCLUDED.embedding_model,
                failure_reason = EXCLUDED.failure_reason,
                reasoning_factors = EXCLUDED.reasoning_factors,
                agent_trace = EXCLUDED.agent_trace
            """
        ),
        {
            "aid": str(assessment_id),
            "provider": provider,
            "model": model,
            "prompt_version": PROMPT_VERSION,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost_usd": cost_usd,
            "latency_ms": latency_ms,
            "confidence": confidence,
            "ctx": [str(i) for i in context_ids],
            "ev": [str(i) for i in evidence_ids],
            "refs": json.dumps(_serialize_refs(retrieved_references)),
            "retrieval_mode": retrieval_mode,
            "retrieval_quality": retrieval_quality,
            "retrieval_score": retrieval_score,
            "embedding_model": embedding_model,
            "failure_reason": failure_reason,
            "factors": json.dumps(_serialize_factors(reasoning_factors or [])),
            "agent_trace": json.dumps(agent_trace or []),
        },
    )
    await record_ai_ops_event(
        session,
        assessment_id=assessment_id,
        review_id=review_id,
        status=status,
        provider=provider,
        model=model,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        cost_usd=cost_usd,
        latency_ms=latency_ms,
        retrieval_mode=retrieval_mode,
        retrieval_score=retrieval_score,
        failure_reason=failure_reason,
        llm_attempt_count=llm_attempt_count,
        llm_fallback_count=llm_fallback_count,
        degraded=degraded,
    )


async def run_assessment_job(
    assessment_id: UUID,
    *,
    provider_name: str | None = None,
    preclaimed: bool = False,
) -> None:
    settings = get_settings()
    async with SessionLocal() as session:
        row = await session.execute(
            text(
                """
                SELECT id, review_id, status, version
                FROM assessments
                WHERE id = CAST(:id AS uuid)
                """
            ),
            {"id": str(assessment_id)},
        )
        assessment = row.first()
        if assessment is None:
            logger.warning("assessment %s not found", assessment_id)
            return
        am = assessment._mapping
        status = am["status"]
        if status not in ("pending", "generating"):
            logger.info(
                "skip assessment %s — status=%s", assessment_id, status
            )
            return

        if preclaimed:
            if status != "generating":
                logger.info(
                    "skip assessment %s — preclaimed but status=%s",
                    assessment_id,
                    status,
                )
                return
            review_id = am["review_id"]
        else:
            # Durable claim — only one worker wins (pending → generating).
            claimed = await session.execute(
                text(
                    """
                    UPDATE assessments SET status = 'generating', claimed_at = now()
                    WHERE id = (
                        SELECT id FROM assessments
                        WHERE id = CAST(:id AS uuid)
                          AND status = 'pending'
                        FOR UPDATE SKIP LOCKED
                    )
                    RETURNING id, review_id
                    """
                ),
                {"id": str(assessment_id)},
            )
            claim_row = claimed.first()
            if claim_row is None:
                logger.info(
                    "skip assessment %s — already claimed or not pending",
                    assessment_id,
                )
                return
            await session.commit()
            review_id = claim_row._mapping["review_id"]

        review = await get_review(session, review_id)
        if review is None:
            logger.error("review %s missing for assessment %s", review_id, assessment_id)
            return

        # Review may have been decided/closed while this job was queued or mid-flight.
        # assessment_completed is only legal from assessing — drop the job quietly.
        if review.state != "assessing":
            await session.execute(
                text(
                    """
                    UPDATE assessments
                    SET status = 'superseded',
                        summary = :summary
                    WHERE id = CAST(:id AS uuid)
                      AND status IN ('pending', 'generating')
                    """
                ),
                {
                    "id": str(assessment_id),
                    "summary": (
                        f"Skipped: review left assessing (state={review.state})"
                    ),
                },
            )
            await session.commit()
            logger.info(
                "skip assessment %s — review %s is %s",
                assessment_id,
                review_id,
                review.state,
            )
            return

        facts = await _load_true_facts(session, review.asset_id)
        context_ids = await _context_ids(session, review.asset_id)
        asset_name, asset_zone = await _load_asset(session, review.asset_id)
        fact_types = [f.fact_type for f in facts]
        query = build_retrieval_query(
            fact_types=fact_types,
            triggered_by=review.triggered_by,
            asset_name=asset_name,
            asset_zone=asset_zone,
        )

        hybrid = await retrieve(session, query=query, fact_types=fact_types)
        enriched_refs = await enrich_references(session, hybrid.refs)
        evidence_ids = [r.id for r in enriched_refs]

        # Resolve context + worker names for structured reasoning factors
        ctx_views = await load_valid_context(session, review.asset_id)
        worker_ids = [
            str(e.payload.get("worker_id"))
            for e in ctx_views
            if e.category in ("worker_location", "certification")
            and e.payload.get("worker_id")
        ]
        name_map = await resolve_worker_names(session, worker_ids)
        context_entries = []
        for e in ctx_views:
            payload = dict(e.payload)
            wid = payload.get("worker_id")
            if wid and str(wid) in name_map:
                payload["worker_name"] = name_map[str(wid)]
            context_entries.append(
                {
                    "id": str(e.id),
                    "asset_id": str(e.asset_id),
                    "category": e.category,
                    "payload": payload,
                    "provider": e.provider,
                    "valid_from": e.valid_from,
                    "valid_until": e.valid_until,
                    "confidence": e.confidence,
                }
            )
        area_owner = await get_zone_owner(session, asset_zone)
        reasoning_factors = build_reasoning_factors(
            facts,
            context_entries,
            enriched_refs,
            asset_name=asset_name,
            area_owner=area_owner,
        )

        # Neighborhood context for Spatial Agent — skip when spatial cannot fire
        plant_context_entries: list[dict] = []
        if should_load_plant_neighborhood(fact_types, context_entries):
            near = neighbors_within_radius(get_plant_graph(), str(review.asset_id))
            neighbor_ids = [UUID(n["asset_id"]) for n in near]
            plant_views = await load_valid_context_for_assets(
                session, [review.asset_id, *neighbor_ids]
            )
            plant_context_entries = [
                {
                    "id": str(e.id),
                    "asset_id": str(e.asset_id),
                    "category": e.category,
                    "payload": dict(e.payload),
                    "provider": e.provider,
                    "valid_from": e.valid_from,
                    "valid_until": e.valid_until,
                    "confidence": e.confidence,
                }
                for e in plant_views
            ]

        # Handover carry-forward for the Shift Handover Agent. Loaded here rather
        # than in the node because graph nodes are pure — they never touch the DB.
        carried_handover_items = [
            {
                "id": str(row["id"]),
                "handover_id": str(row["handover_id"]),
                "title": row["title"],
                "detail": row.get("detail"),
                "risk_level": row.get("risk_level"),
                "item_type": row.get("item_type"),
                "incoming_actor_name": row.get("incoming_actor_name"),
                "outgoing_actor_name": row.get("outgoing_actor_name"),
                "hours_outstanding": (
                    (datetime.now(timezone.utc) - row["issued_at"]).total_seconds()
                    / 3600.0
                    if row.get("issued_at")
                    else None
                ),
            }
            for row in await fetch_unacknowledged_for_asset(
                session, asset_id=review.asset_id
            )
        ]

        generation = None
        agent_trace: list = []
        spatial_links: list = []
        llm_stats: dict = {
            "llm_attempt_count": 0,
            "llm_fallback_count": 0,
            "degraded": False,
        }
        last_error: Exception | None = None
        max_retries = settings.assessment_max_retries
        for attempt in range(max_retries + 1):
            try:
                generation, agent_trace, spatial_links, llm_stats = await run_agent_assessment(
                    review_id=review_id,
                    assessment_id=assessment_id,
                    asset_id=review.asset_id,
                    asset_name=asset_name,
                    asset_zone=asset_zone,
                    facts=facts,
                    context_entries=context_entries,
                    retrieved_references=enriched_refs,
                    provider_name=provider_name,
                    plant_context_entries=plant_context_entries,
                    carried_handover_items=carried_handover_items,
                )
                last_error = None
                break
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                logger.warning(
                    "langgraph attempt %d failed for %s: %s",
                    attempt + 1,
                    assessment_id,
                    exc,
                )

        if generation is None or last_error is not None:
            failure_reason = _classify_failure(last_error)
            await session.execute(
                text(
                    """
                    UPDATE assessments
                    SET status = 'failed', summary = :summary
                    WHERE id = CAST(:id AS uuid)
                    """
                ),
                {
                    "id": str(assessment_id),
                    "summary": f"Assessment generation failed: {last_error}",
                },
            )
            await _persist_metadata(
                session,
                assessment_id,
                review_id=review_id,
                status="failed",
                provider=provider_name or settings.ai_provider,
                model="unknown",
                tokens_in=0,
                tokens_out=0,
                cost_usd=0.0,
                latency_ms=0,
                confidence=0.0,
                context_ids=context_ids,
                evidence_ids=evidence_ids,
                retrieved_references=enriched_refs,
                retrieval_mode=hybrid.mode,
                retrieval_quality=hybrid.quality,
                retrieval_score=hybrid.best_score,
                embedding_model=hybrid.embedding_model,
                failure_reason=failure_reason,
                reasoning_factors=reasoning_factors,
                agent_trace=agent_trace,
                llm_attempt_count=int(llm_stats.get("llm_attempt_count") or 0),
                llm_fallback_count=int(llm_stats.get("llm_fallback_count") or 0),
                degraded=bool(llm_stats.get("degraded")),
            )
            from app.notifications.service import notify_assessment_failed

            await notify_assessment_failed(
                session, review_id=review_id, owner_id=review.owner_id
            )
            await session.commit()
            await manager.broadcast(
                "assessment.failed",
                {
                    "assessment_id": str(assessment_id),
                    "review_id": str(review_id),
                    "error": str(last_error),
                    "failure_reason": failure_reason,
                    "ts": datetime.now(timezone.utc).isoformat(),
                },
            )
            return

        # Supersede prior complete assessments
        await session.execute(
            text(
                """
                UPDATE assessments
                SET status = 'superseded'
                WHERE review_id = CAST(:review_id AS uuid)
                  AND status = 'complete'
                  AND id <> CAST(:id AS uuid)
                """
            ),
            {"review_id": str(review_id), "id": str(assessment_id)},
        )

        result = generation.result
        await session.execute(
            text(
                """
                UPDATE assessments
                SET status = 'complete',
                    risk_level = :risk,
                    summary = :summary,
                    derived_fact_ids = CAST(:fact_ids AS uuid[])
                WHERE id = CAST(:id AS uuid)
                """
            ),
            {
                "id": str(assessment_id),
                "risk": result.risk_level,
                "summary": result.summary,
                "fact_ids": [str(f.id) for f in facts],
            },
        )

        for rec in result.recommendations:
            await session.execute(
                text(
                    """
                    INSERT INTO recommendations (assessment_id, text, rationale, disposition)
                    VALUES (
                        CAST(:aid AS uuid), :text, :rationale, 'proposed'
                    )
                    """
                ),
                {
                    "aid": str(assessment_id),
                    "text": rec.text,
                    "rationale": rec.rationale,
                },
            )

        await _persist_metadata(
            session,
            assessment_id,
            review_id=review_id,
            status="complete",
            provider=generation.provider,
            model=generation.model,
            tokens_in=generation.input_tokens,
            tokens_out=generation.output_tokens,
            cost_usd=generation.estimated_cost_usd,
            latency_ms=generation.latency_ms,
            confidence=result.confidence,
            context_ids=context_ids,
            evidence_ids=evidence_ids,
            retrieved_references=enriched_refs,
            retrieval_mode=hybrid.mode,
            retrieval_quality=hybrid.quality,
            retrieval_score=hybrid.best_score,
            embedding_model=hybrid.embedding_model,
            failure_reason=None,
            reasoning_factors=_augment_reasoning_with_predictive_trend(
                reasoning_factors=reasoning_factors,
                agent_trace=agent_trace,
                asset_name=asset_name,
                settings=settings,
            ),
            agent_trace=agent_trace,
            llm_attempt_count=int(llm_stats.get("llm_attempt_count") or 0),
            llm_fallback_count=int(llm_stats.get("llm_fallback_count") or 0),
            degraded=bool(llm_stats.get("degraded")),
        )
        from app.notifications.service import notify_assessment_completed

        sensor_critical = bool(
            set(fact_types) & {"critical_gas", "critical_temperature"}
        )
        await notify_assessment_completed(
            session,
            review_id=review_id,
            owner_id=review.owner_id,
            risk_level=result.risk_level,
            sensor_critical=sensor_critical,
        )
        await session.commit()

        try:
            await transition_review(
                session,
                review_id,
                ReviewEvent.ASSESSMENT_COMPLETED,
                f"assessment:{generation.provider}",
                extra_payload={"assessment_id": str(assessment_id)},
            )
        except IllegalTransitionError as exc:
            # Race: supervisor decided/closed (or manual assessment completed)
            # while we were generating. Supersede this row — do not crash.
            await session.execute(
                text(
                    """
                    UPDATE assessments
                    SET status = 'superseded',
                        summary = COALESCE(
                            summary,
                            :summary
                        )
                    WHERE id = CAST(:id AS uuid)
                      AND status = 'complete'
                    """
                ),
                {
                    "id": str(assessment_id),
                    "summary": (
                        f"Superseded after race: review left assessing ({exc})"
                    ),
                },
            )
            await session.commit()
            logger.info(
                "assessment %s complete but review transition skipped: %s",
                assessment_id,
                exc,
            )
            return

        await manager.broadcast(
            "assessment.completed",
            {
                "assessment_id": str(assessment_id),
                "review_id": str(review_id),
                "risk_level": result.risk_level,
                "retrieval_mode": hybrid.mode,
                "provider": generation.provider,
                "agent_step_count": len(agent_trace),
                "spatial_link_count": len(spatial_links),
                "ts": datetime.now(timezone.utc).isoformat(),
            },
        )
        logger.info(
            "assessment %s complete (provider=%s mode=%s risk=%s)",
            assessment_id,
            generation.provider,
            hybrid.mode,
            result.risk_level,
        )
