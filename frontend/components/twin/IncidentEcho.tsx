"use client";

import type { ReasoningFactor, RetrievedReference } from "@/shared/schemas";
import styles from "./IncidentEcho.module.css";

type WithFactors = { reasoning_factors?: ReasoningFactor[] | null };

function topIncident(
  assessment: WithFactors | null | undefined,
): RetrievedReference | null {
  const refs: RetrievedReference[] = [];
  for (const factor of assessment?.reasoning_factors ?? []) {
    for (const ref of factor.evidence ?? []) refs.push(ref);
  }
  const incidents = refs.filter(
    (r) => r.source === "historical_incidents" && (r.title || r.snippet),
  );
  if (!incidents.length) return null;
  return [...incidents].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
}

function agoLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const months = Math.round((Date.now() - then) / (1000 * 60 * 60 * 24 * 30));
  if (months < 1) return "recently";
  if (months === 1) return "~1 month ago";
  if (months < 12) return `~${months} months ago`;
  const years = Math.round(months / 12);
  return years === 1 ? "~1 year ago" : `~${years} years ago`;
}

/**
 * Moment B — the historical incident echo. When the compound condition forms, the
 * retrieval layer surfaces a matching prior near-miss on this unit; this banner makes
 * that match impossible to miss and ties it to the real Visakhapatnam story. The score
 * shown is a genuine cosine similarity when semantic retrieval is configured
 * (retrieval_path === "rag"); otherwise the match is labelled as a pattern echo without
 * implying a vector score.
 */
export function IncidentEcho({
  assessment,
}: {
  assessment: WithFactors | null | undefined;
}) {
  const match = topIncident(assessment);
  if (!match) return null;

  const ago = agoLabel(match.occurred_at);
  const isSemantic = match.retrieval_path === "rag";
  const score =
    isSemantic && typeof match.score === "number"
      ? Math.round(match.score * 100)
      : null;

  return (
    <div className={styles.echo} data-tone="critical" role="alert">
      <div className={styles.head}>
        <span className={styles.pulse} aria-hidden />
        <span className={styles.kicker}>Pattern match — prior near-miss</span>
        {score !== null ? (
          <span className={styles.score} title="Semantic similarity (cosine)">
            {score}% match
          </span>
        ) : null}
      </div>
      <p className={styles.title}>
        {match.title ?? "Historical near-miss"}
        {ago ? <span className={styles.when}> · {ago} on this unit</span> : null}
      </p>
      {match.snippet ? <p className={styles.body}>{match.snippet}</p> : null}
      <p className={styles.tie}>
        The same fusion of elevated gas, active hot work and incomplete isolation
        preceded the Visakhapatnam coke-oven fatalities — treat the conditions below
        as mandatory, not advisory.
      </p>
    </div>
  );
}
