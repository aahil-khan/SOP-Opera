"""
Measure the RAG quality gate against real cosine scores (W5).

`RAG_SCORE_THRESHOLD` was calibrated for hash "embeddings", where similarity is
noise. Setting a gate for real vectors by guessing is exactly the unbacked number
this project refuses to ship, so this script measures the corpus instead: it
embeds the retrieval query for the hero scenario with the configured provider,
scores it against every seeded knowledge chunk, and prints the separation between
the chunks that *should* match and the rest.

The right threshold sits between those two populations. Run it after changing
`EMBEDDING_PROVIDER`, and put the printed numbers in the PR.

    EMBEDDING_PROVIDER=ollama python -m app.eval.rag_calibration

No database required — it embeds the same corpus text `seed_embeddings()` does.
"""

from __future__ import annotations

import argparse
import asyncio
import math

from app.assessment.embeddings import active_embedding_model, embed_texts
from app.assessment.retrieval import build_retrieval_query
from app.core.config import get_settings
from app.db.seed_embeddings import INCIDENTS, REGULATIONS, SOPS

# The hero query: elevated coke-oven gas with an open hot-work permit and a
# worker in the zone — the state the compound engine blocks on.
HERO_FACTS = [
    "elevated_gas",
    "incomplete_isolation",
    "zone_occupied",
]

# Chunks a competent retriever should return for that query. Named explicitly so
# "good" is defined before the scores are looked at, not after.
EXPECTED_MATCH_TERMS = (
    "hot work",
    "gas",
    "coke oven",
    "permit",
    "flammable",
    "inflammable",
    "explosive",
)


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)


def corpus() -> list[tuple[str, str, str]]:
    """(source_type, label, text) exactly as `seed_embeddings()` chunks it."""
    out: list[tuple[str, str, str]] = []
    for _rid, code, title, body, _cat in REGULATIONS:
        out.append(("regulations", f"{code}: {title}", f"{code}: {title}. {body}"))
    for _sid, title, body, _cat in SOPS:
        out.append(("sops", title, f"{title}. {body}"))
    for _iid, _asset, desc, _cat in INCIDENTS:
        out.append(("historical_incidents", desc[:60], desc))
    return out


def _looks_relevant(text: str) -> bool:
    low = text.lower()
    return any(term in low for term in EXPECTED_MATCH_TERMS)


async def calibrate(source_filter: str | None = None) -> dict[str, float | None]:
    settings = get_settings()
    query = build_retrieval_query(
        fact_types=HERO_FACTS,
        triggered_by="sensor",
        asset_name="Coke Oven Battery 3",
        asset_zone="coke-oven-battery",
    )
    # Default to the source types the gate actually searches. Measuring over the
    # whole corpus is misleading: regulations and SOPs are not in
    # rag_vector_source_types, so their scores can never reach the gate, yet they
    # dominated the top of the ranking and pulled the suggested threshold up to a
    # value that rejected every incident.
    if source_filter is None:
        allowed = set(settings.rag_vector_source_types)
        scope = f"rag_vector_source_types={sorted(allowed)}"
    elif source_filter == "all":
        allowed = None
        scope = "ENTIRE CORPUS — includes source types the gate never searches"
    else:
        allowed = {source_filter}
        scope = f"--source {source_filter}"
    rows = [r for r in corpus() if allowed is None or r[0] in allowed]
    vectors = await embed_texts([query] + [r[2] for r in rows])
    qv, cvs = vectors[0], vectors[1:]

    scored = [
        (src, label, _cosine(qv, cv), _looks_relevant(text))
        for (src, label, text), cv in zip(rows, cvs)
    ]
    scored.sort(key=lambda t: t[2], reverse=True)

    print(f"provider      : {settings.embedding_provider}")
    print(f"model         : {active_embedding_model()}")
    print(f"current gate  : {settings.rag_score_threshold}")
    print(f"scored over   : {scope}")
    print(f"query         : {query[:110]}...")
    print()
    print(f"{'score':>7}  {'rel?':<5} {'source':<22} label")
    for src, label, score, rel in scored:
        print(f"{score:7.3f}  {'yes' if rel else 'no':<5} {src:<22} {label[:60]}")

    rel_scores = [s for _, _, s, r in scored if r]
    irr_scores = [s for _, _, s, r in scored if not r]
    best_rel = max(rel_scores, default=None)
    best_irr = max(irr_scores, default=None)
    print()
    print(f"best relevant   : {best_rel if best_rel is None else round(best_rel, 3)}")
    print(f"best irrelevant : {best_irr if best_irr is None else round(best_irr, 3)}")
    if best_rel is not None and best_irr is not None:
        suggested = round((best_rel + best_irr) / 2, 2)
        print(
            f"suggested gate  : {suggested}  "
            "(midpoint — passes the relevant hit, rejects the best distractor)"
        )
        if best_rel < get_settings().rag_score_threshold:
            print(
                "NOTE: with the current gate every hit is rejected, so retrieval "
                "always falls through to deterministic SQL."
            )
        return {
            "best_relevant": best_rel,
            "best_irrelevant": best_irr,
            "suggested_threshold": suggested,
        }
    return {"best_relevant": best_rel, "best_irrelevant": best_irr}


def main() -> None:
    parser = argparse.ArgumentParser(description="RAG gate calibration (W5)")
    parser.add_argument(
        "--source",
        default=None,
        help=(
            "source type to score over. Default: whatever RAG_VECTOR_SOURCE_TYPES "
            "is set to, i.e. what the gate actually searches. Pass 'all' to score "
            "the entire corpus (informational only — the suggestion it prints is "
            "NOT a valid gate), or one of regulations | sops | historical_incidents."
        ),
    )
    args = parser.parse_args()
    asyncio.run(calibrate(args.source))


if __name__ == "__main__":
    main()
