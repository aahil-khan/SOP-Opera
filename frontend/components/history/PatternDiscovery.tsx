"use client";

/**
 * Patterns the rules can't see (W13).
 *
 * A review queue for proposed changes to the safety policy, not an analytics
 * panel. Pattern mining pulls a design toward charts and lift tables; the person
 * reading this is a supervisor deciding whether to accept a suggestion, so every
 * row is a proposal with a claim, an owner and an action, and the statistics sit
 * underneath as supporting evidence.
 *
 * The empty state matters more than the populated one. It is what an honest
 * corpus produces most of the time, and it has to read as an audit pass —
 * "everything recurring here is already stated by a rule" — rather than as a
 * blank screen.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  dismissPattern,
  fetchPatterns,
  ratifyPattern,
  type MinedPattern,
  type PatternFamily,
  type PatternsView,
} from "@/lib/liveApi";
import styles from "./PatternDiscovery.module.css";

/**
 * Typed by the axis the pattern spans. The axis *is* the reason the rule engine
 * cannot express it, so this label carries information rather than decorating.
 */
const FAMILY_LABEL: Record<PatternFamily, string> = {
  recurrence: "Across events",
  asset_pair: "Across assets",
  shift_band: "Across shifts",
  within_event: "Within one event",
};

function ratioText(ratio: number): string {
  return `${ratio.toFixed(1)}×`;
}

function spanLabel(from: string | null, to: string | null): string {
  if (!from || !to) return "no closed reviews yet";
  const fmt = (s: string) =>
    new Date(s).toLocaleDateString("en", { month: "short", year: "numeric" });
  return `${fmt(from)} – ${fmt(to)}`;
}

function decidedLabel(p: MinedPattern): string {
  const when = p.decided_at
    ? new Date(p.decided_at).toLocaleDateString("en", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";
  const verb = p.state === "ratified" ? "Accepted" : "Set aside";
  return `${verb} by ${p.decided_by ?? "unknown"}${when ? ` · ${when}` : ""}`;
}

export function PatternDiscovery({ months = 12 }: { months?: number }) {
  const [view, setView] = useState<PatternsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async (window: number) => {
    setLoading(true);
    try {
      setView(await fetchPatterns(window));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mine patterns");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(months);
  }, [load, months]);

  const decide = useCallback(
    async (key: string, next: "ratified" | "dismissed") => {
      setBusyKey(key);
      setError(null);
      try {
        const updated =
          next === "ratified"
            ? await ratifyPattern(key)
            : await dismissPattern(key);
        setView((prev) =>
          prev
            ? {
                ...prev,
                patterns: prev.patterns.map((p) =>
                  p.key === updated.key ? updated : p,
                ),
              }
            : prev,
        );
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "That did not go through — try again.",
        );
      } finally {
        setBusyKey(null);
      }
    },
    [],
  );

  const scope = view?.scope;
  // Ranked by the miner already; kept as-is so the panel and the API agree.
  const patterns = useMemo(() => view?.patterns ?? [], [view]);

  return (
    <section
      className={styles.panel}
      aria-labelledby="patterns-heading"
      data-tour="patterns"
    >
      <header className={styles.head}>
        <div className={styles.titleRow}>
          <h2 id="patterns-heading" className={styles.title}>
            Patterns the rules can&rsquo;t see
          </h2>
          {view?.corpus_is_seeded ? (
            <span className={styles.provenance}>Demonstration corpus</span>
          ) : null}
        </div>
        <p className={styles.mechanism}>
          The rule engine reads one event at a time and keeps no memory between
          them. These patterns span events, assets and shifts, so no rule could
          state them.
        </p>
        {scope ? (
          <p className={styles.scope}>
            <span>
              Mined <b>{scope.review_count}</b> closed{" "}
              {scope.review_count === 1 ? "review" : "reviews"}
            </span>
            <span>
              <b>{scope.asset_count}</b>{" "}
              {scope.asset_count === 1 ? "asset" : "assets"}
            </span>
            <span>
              <b>{spanLabel(scope.first_review_at, scope.last_review_at)}</b>
            </span>
            <span>
              Proposed at <b>≥{scope.min_support}</b> occurrences and{" "}
              <b>≥{scope.min_ratio.toFixed(1)}×</b> the base rate
            </span>
          </p>
        ) : null}
      </header>

      {/* Standing, never inside a card: the copy carries the safety guarantee
          so nobody has to trust a caption. */}
      <p className={styles.constraint}>
        <strong>Accepting records a watch item, not a rule.</strong> Nothing here
        changes what the plant blocks on — the gate stays in{" "}
        <code>risk/policy.py</code>, where every verdict is decided. Each decision
        is signed and written to the audit chain.
      </p>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
          <button
            type="button"
            className={styles.retry}
            onClick={() => void load(months)}
          >
            Retry
          </button>
        </p>
      ) : null}

      {loading && !view ? (
        <p className={styles.loading}>Mining closed history…</p>
      ) : null}

      {view && patterns.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Nothing recurring enough to propose.</p>
          <p className={styles.emptyBody}>
            Every recurring pattern in this corpus is one the rule set already
            states. Re-run after the next closed review.
          </p>
          {scope ? (
            <span className={styles.emptyScope}>
              {scope.review_count} reviews · {scope.asset_count} assets ·{" "}
              {scope.window_months} months · ≥{scope.min_support} occurrences · ≥
              {scope.min_ratio.toFixed(1)}× base rate
            </span>
          ) : null}
        </div>
      ) : null}

      {patterns.length > 0 ? (
        <ul className={styles.list}>
          {patterns.map((p) => (
            <li key={p.key}>
              <PatternCard
                pattern={p}
                busy={busyKey === p.key}
                onDecide={decide}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function PatternCard({
  pattern: p,
  busy,
  onDecide,
}: {
  pattern: MinedPattern;
  busy: boolean;
  onDecide: (key: string, next: "ratified" | "dismissed") => void;
}) {
  const covered = p.covered_by != null;
  return (
    <article className={styles.card} data-state={p.state} data-covered={covered}>
      <div className={styles.cardTop}>
        <span className={styles.kind}>{FAMILY_LABEL[p.family]}</span>
        {p.state !== "candidate" ? (
          <span className={styles.state} data-state={p.state}>
            {p.state === "ratified" ? "Accepted · watch item" : "Set aside"}
          </span>
        ) : null}
        <span className={styles.coverage} data-covered={covered}>
          {covered ? "Already covered by a rule" : "No rule covers this"}
        </span>
      </div>

      <p className={styles.claim}>{p.claim}</p>

      <div className={styles.evidence}>
        <span>
          <b>{p.hits}</b> of <b>{p.trials}</b> times
        </span>
        <span>
          <b>{ratioText(p.ratio)}</b> the base rate
        </span>
      </div>

      <div className={styles.why}>
        <span>
          {covered ? (
            <>
              <b>Nothing to propose:</b> <code>{p.covered_by}</code> already
              blocks this. Shown so the mined set is complete, not filtered to
              flatter.
            </>
          ) : (
            <>
              <b>Why no rule can say this:</b> {p.why_no_rule}
            </>
          )}
        </span>
        {p.review_ids.length > 0 ? (
          <a className={styles.drill} href={`/reports?review=${p.review_ids[0]}`}>
            {p.review_ids.length} {p.review_ids.length === 1 ? "review" : "reviews"} ›
          </a>
        ) : null}
      </div>

      {p.state === "candidate" && !covered ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btn}
            disabled={busy}
            onClick={() => onDecide(p.key, "dismissed")}
          >
            Set aside
          </button>
          <button
            type="button"
            className={styles.btn}
            data-primary="true"
            disabled={busy}
            onClick={() => onDecide(p.key, "ratified")}
          >
            Accept as watch item
          </button>
        </div>
      ) : null}

      {p.state !== "candidate" ? (
        <p className={styles.decided}>{decidedLabel(p)}</p>
      ) : null}
    </article>
  );
}
