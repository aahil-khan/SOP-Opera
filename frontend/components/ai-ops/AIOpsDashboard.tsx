"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchAiOpsEvents,
  fetchAiOpsSummary,
  fetchProviderState,
  putProviderState,
  testProviderConnection,
  type AiOpsEvent,
  type AiOpsSummary,
  type ProviderConnection,
  type ProviderState,
} from "@/lib/liveApi";
import {
  providerStatusTone,
  providerTitle,
  type Tone,
} from "@/lib/aiOpsProviderPresentation";
import { RefreshAck, useRefreshAck } from "@/components/common/RefreshAck";
import styles from "./AIOpsDashboard.module.css";

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function fmtLatency(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

function fmtCost(usd: number): string {
  if (usd <= 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function rateTone(rate: number, goodMin: number, warnMin: number): Tone {
  if (rate >= goodMin) return "good";
  if (rate >= warnMin) return "warn";
  return "bad";
}

function inverseRateTone(rate: number, warnMax: number, badMax: number): Tone {
  if (rate <= warnMax) return "good";
  if (rate <= badMax) return "warn";
  return "bad";
}

function HeroStat({
  value,
  label,
  hint,
  tone = "neutral",
}: {
  value: string;
  label: string;
  hint: string;
  tone?: Tone;
}) {
  return (
    <div className={styles.hero} data-tone={tone} title={hint}>
      <span className={styles.heroValue}>{value}</span>
      <span className={styles.heroLabel}>{label}</span>
      <span className={styles.heroHint}>{hint}</span>
    </div>
  );
}

function RateBar({
  label,
  value,
  displayValue,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: number;
  displayValue: string;
  hint: string;
  tone?: Tone;
}) {
  return (
    <div className={styles.rate} data-tone={tone} title={hint}>
      <div className={styles.rateHead}>
        <span className={styles.rateLabel}>{label}</span>
        <span className={styles.rateValue}>{displayValue}</span>
      </div>
      <div className={styles.rateTrack}>
        <div
          className={styles.rateFill}
          style={{ width: `${clamp01(value) * 100}%` }}
        />
      </div>
      <p className={styles.rateDetail}>{hint}</p>
    </div>
  );
}

function StatPair({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className={styles.statPair} title={hint}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

export function AIOpsDashboard() {
  const [summary, setSummary] = useState<AiOpsSummary | null>(null);
  const [events, setEvents] = useState<AiOpsEvent[] | null>(null);
  const [provider, setProvider] = useState<ProviderState | null>(null);
  const [providerSelectValue, setProviderSelectValue] =
    useState<string>("__default__");
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerCheck, setProviderCheck] = useState<ProviderConnection | null>(
    null,
  );
  const [providerStatusText, setProviderStatusText] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const refreshAck = useRefreshAck();

  /** Resolves true when the fetch completed, so the caller can acknowledge it. */
  const refresh = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    try {
      const [data, recent, prov] = await Promise.all([
        fetchAiOpsSummary(),
        fetchAiOpsEvents(12),
        fetchProviderState(),
      ]);
      setSummary(data);
      setEvents(recent);
      setProvider(prov);
      setProviderSelectValue(
        prov.source === "runtime_override" ? prov.active_provider : "__default__",
      );
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectProvider = useCallback(
    async (value: string) => {
      setProviderSelectValue(value);
      setProviderBusy(true);
      setProviderStatusText("Testing connection...");
      setProviderCheck(null);
      try {
        const selected = value === "__default__" ? null : value;
        const check = await testProviderConnection(selected);
        setProviderCheck(check);
        if (!check.ok) {
          throw new Error(
            `${providerTitle(check.provider)} connection failed: ${
              check.reason ?? "provider is unavailable"
            }`,
          );
        }
        const next = await putProviderState(selected);
        setProvider(next);
        setProviderSelectValue(
          next.source === "runtime_override"
            ? next.active_provider
            : "__default__",
        );
        setProviderStatusText("Connected");
        setError(null);
      } catch (err) {
        setProviderStatusText("Connection failed");
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setProviderBusy(false);
      }
    },
    [],
  );

  const totalTokens =
    (summary?.total_input_tokens ?? 0) + (summary?.total_output_tokens ?? 0);
  const tracingOn = Boolean(summary?.langsmith_enabled);
  const inputShare =
    summary && totalTokens > 0 ? summary.total_input_tokens / totalTokens : 0;
  const activeConnection = providerCheck ?? provider?.connection ?? null;
  const selectedProviderLabel = providerTitle(provider?.active_provider);
  const selectedModel = provider?.active_model ?? provider?.connection.model ?? "—";

  return (
    <div className={styles.wrap} data-tour="aiops">
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>AI Ops</h1>
          <p className={styles.subtitle}>
            Agent-path spend and pipeline health
            {summary ? ` · ${summary.total_assessments} assessments` : ""}
          </p>
        </div>
        <div className={styles.headerControls}>
          <label
            className={styles.providerPicker}
            title={
              provider?.scope ??
              "Provider for assessments enqueued from now on (in-process; resets on restart)"
            }
          >
            <span className={styles.providerLabel}>Provider</span>
            <select
              className={styles.providerSelect}
              disabled={providerBusy || provider == null}
              value={providerSelectValue}
              onChange={(e) => void selectProvider(e.target.value)}
            >
              <option value="__default__">
                default ({providerTitle(provider?.env_default)})
              </option>
              {(provider?.available ?? []).map((p) => (
                <option key={p} value={p}>
                  {providerTitle(p)}
                </option>
              ))}
            </select>
          </label>
          <span
            className={styles.providerStatus}
            data-tone={providerStatusTone(
              activeConnection?.status,
              activeConnection?.ok,
            )}
            title={
              provider?.fallback_reason ??
              activeConnection?.reason ??
              provider?.scope ??
              undefined
            }
          >
            {providerStatusText ??
              `${providerTitle(activeConnection?.provider)} · ${
                activeConnection?.status ?? "not tested"
              }`}
          </span>
          <span
            className={styles.traceChip}
            data-on={tracingOn}
            title={
              tracingOn
                ? `Project: ${summary?.langsmith_project ?? "sop-opera"}`
                : "Set LANGCHAIN_TRACING_V2 and LANGCHAIN_API_KEY"
            }
          >
            <span className={styles.liveDot} data-on={tracingOn} aria-hidden />
            {tracingOn ? "LangSmith" : "Offline"}
          </span>
          <button
            type="button"
            className={styles.ctrl}
            disabled={loading}
            // Acknowledge only user-initiated refreshes; refresh() also fires
            // on mount, where a chip would be noise rather than feedback.
            onClick={() => {
              void refresh().then((ok) => {
                if (ok) refreshAck.ack();
              });
            }}
          >
            {loading ? "…" : "Refresh"}
          </button>
          <RefreshAck shown={refreshAck.acked} label="Refreshed" />
          {tracingOn && summary?.langsmith_url ? (
            <a
              className={styles.primaryCtrl}
              href={summary.langsmith_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open LangSmith
            </a>
          ) : (
            <button type="button" className={styles.primaryCtrl} disabled>
              Open LangSmith
            </button>
          )}
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      <section className={styles.providerBand}>
        <div className={styles.providerFact}>
          <span>Effective provider</span>
          <strong>{selectedProviderLabel}</strong>
        </div>
        <div className={styles.providerFact}>
          <span>Model</span>
          <strong>{selectedModel}</strong>
        </div>
        <div className={styles.providerFact}>
          <span>Connection</span>
          <strong>
            {providerBusy
              ? "Testing connection..."
              : activeConnection?.status ?? "Not tested"}
          </strong>
        </div>
        <div className={styles.providerFact}>
          <span>Default source</span>
          <strong>
            {provider?.source === "runtime_override"
              ? "Runtime override"
              : provider?.source === "auto_default"
                ? "Automatic"
                : "Configured env"}
          </strong>
        </div>
      </section>

      <div className={styles.heroRow} aria-label="Key metrics">
        <HeroStat
          value={summary ? pct(summary.success_rate) : "—"}
          label="Success rate"
          hint="Share of assessment runs that reached a complete verdict, all-time"
          tone={summary ? rateTone(summary.success_rate, 0.95, 0.85) : "neutral"}
        />
        <HeroStat
          value={fmtLatency(summary?.p50_latency_ms)}
          label="Latency p50"
          hint={
            summary
              ? `Median wall-clock time from job claim to persisted verdict. p95 ${fmtLatency(summary.p95_latency_ms)} · mean ${fmtLatency(summary.mean_latency_ms)}, over the last ${summary.latency_sample_count} completed run(s). The median is what a supervisor usually waits; p95 is the slow tail a mean hides.`
              : "Median wall-clock time from job claim to persisted verdict"
          }
        />
        <HeroStat
          value={summary ? fmtTokens(totalTokens) : "—"}
          label="Total tokens"
          hint="Combined input + output tokens across every LangGraph LLM call"
        />
        <HeroStat
          value={summary ? fmtCost(summary.total_cost_usd) : "—"}
          label="Total cost"
          hint="Estimated USD from token pricing tables — mock and Ollama always record $0"
          tone={summary && summary.total_cost_usd > 0 ? "warn" : "neutral"}
        />
        <HeroStat
          value={
            summary
              ? `${summary.blind_channel_count}/${summary.asset_count}`
              : "—"
          }
          label="Blind channels"
          hint={
            summary && summary.degraded_channel_count > 0
              ? `Assets with no live sensor reading — plus ${summary.degraded_channel_count} degraded (low confidence / fault). Blind is not safe.`
              : "Assets with no live sensor reading inside the stale window. Blind is not safe."
          }
          tone={
            summary && summary.blind_channel_count > 0 ? "warn" : "good"
          }
        />
      </div>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Reliability</h2>
            <p className={styles.panelSubtitle}>
              How often assessment runs finish cleanly
            </p>
          </header>
          <div className={styles.panelBody}>
            <RateBar
              label="Success rate"
              value={summary?.success_rate ?? 0}
              displayValue={summary ? pct(summary.success_rate) : "—"}
              hint="Share of runs that reached a complete verdict without failing validation or a provider error"
              tone={
                summary ? rateTone(summary.success_rate, 0.95, 0.85) : "neutral"
              }
            />
            <RateBar
              label="LLM fallback rate"
              value={summary?.llm_fallback_rate ?? 0}
              displayValue={summary ? pct(summary.llm_fallback_rate) : "—"}
              hint="Share of live-provider LLM attempts that fell back to a template response instead of a real model output"
              tone={
                summary
                  ? inverseRateTone(summary.llm_fallback_rate, 0.05, 0.25)
                  : "neutral"
              }
            />
            <div className={styles.statGrid}>
              <StatPair
                label="Failed"
                value={summary ? String(summary.failed_count) : "—"}
                hint="Runs that never reached a verdict"
              />
              <StatPair
                label="Validation failures"
                value={
                  summary ? String(summary.validation_failure_count) : "—"
                }
                hint="Failed runs where the LLM output didn't pass schema validation after retries"
              />
              <StatPair
                label="Provider errors"
                value={summary ? String(summary.provider_error_count) : "—"}
                hint="Failed runs where the provider call itself errored — timeout, API error, or similar"
              />
              <StatPair
                label="Latency p95"
                value={fmtLatency(summary?.p95_latency_ms)}
                hint="Slowest 1 in 20 completed runs — the tail a mean hides, and the number a control room actually feels"
              />
              <StatPair
                label="Latency p50"
                value={fmtLatency(summary?.p50_latency_ms)}
                hint={
                  summary
                    ? `Median completed run, over the last ${summary.latency_sample_count} ${summary.latency_sample_count === 1 ? "sample" : "samples"}`
                    : "Median completed run"
                }
              />
              <StatPair
                label="LLM-degraded"
                value={summary ? String(summary.llm_degraded_count) : "—"}
                hint="Completed runs where at least one agent call fell back to a template while the pipeline still finished"
              />
            </div>
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Retrieval quality</h2>
            <p className={styles.panelSubtitle}>
              How often RAG finds usable evidence
            </p>
          </header>
          <div className={styles.panelBody}>
            <RateBar
              label="RAG hit rate"
              value={summary?.rag_hit_rate ?? 0}
              displayValue={summary ? pct(summary.rag_hit_rate) : "—"}
              hint="Share of retrievals where vector search over historical incidents cleared the relevance quality gate"
              tone={
                summary ? rateTone(summary.rag_hit_rate, 0.8, 0.5) : "neutral"
              }
            />
            <RateBar
              label="RAG fallback rate"
              value={summary?.rag_fallback_rate ?? 0}
              displayValue={summary ? pct(summary.rag_fallback_rate) : "—"}
              hint="Share of runs where vector search missed the quality gate and deterministic SQL filled in"
              tone={
                summary
                  ? inverseRateTone(summary.rag_fallback_rate, 0.15, 0.4)
                  : "neutral"
              }
            />
            <RateBar
              label="Mean retrieval relevance"
              value={summary?.mean_retrieval_relevance ?? 0}
              displayValue={
                summary?.mean_retrieval_relevance == null
                  ? "—"
                  : summary.mean_retrieval_relevance.toFixed(3)
              }
              hint="Average cosine-similarity score of the historical-incident chunks that cleared the RAG quality gate (RAG hits only, 0–1)"
              tone="neutral"
            />
            {summary?.last_retrieval_mode ? (
              <p className={styles.note}>
                Last run:{" "}
                {summary.last_retrieval_score != null
                  ? `vector best ${summary.last_retrieval_score.toFixed(2)} ${
                      summary.last_retrieval_mode === "rag" ? "≥" : "<"
                    } gate ${summary.rag_gate_threshold?.toFixed(2) ?? "—"} → `
                  : ""}
                <strong>
                  {summary.last_retrieval_mode === "rag"
                    ? "vector references used"
                    : "deterministic SQL citations"}
                </strong>
                {summary.last_retrieval_embedding_model
                  ? ` · embeddings: ${summary.last_retrieval_embedding_model}`
                  : ""}
              </p>
            ) : null}
            <div className={styles.statGrid}>
              <StatPair
                label="Retrievals run"
                value={summary ? String(summary.retrieval_ran_count) : "—"}
                hint="Runs that had at least one derived fact to retrieve context for"
              />
              <StatPair
                label="Complete runs"
                value={summary ? String(summary.complete_count) : "—"}
                hint="Runs that reached a persisted verdict"
              />
            </div>
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Agent spend</h2>
            <p className={styles.panelSubtitle}>
              Token volume and USD cost across LLM calls
            </p>
          </header>
          <div className={styles.panelBody}>
            <div
              className={styles.tokenSplit}
              title="Combined input + output tokens across every LangGraph LLM call (domain narration + orchestrator), all-time"
            >
              <div className={styles.tokenSplitHead}>
                <span className={styles.rateLabel}>Input / output tokens</span>
                <span className={styles.rateValue}>
                  {summary ? fmtTokens(totalTokens) : "—"}
                </span>
              </div>
              <div className={styles.tokenTrack}>
                <div
                  className={styles.tokenFillInput}
                  style={{ width: `${inputShare * 100}%` }}
                />
                <div
                  className={styles.tokenFillOutput}
                  style={{ width: `${(1 - inputShare) * 100}%` }}
                />
              </div>
              <div className={styles.tokenLegend}>
                <span>
                  <i className={styles.legendDotInput} aria-hidden />
                  Input {summary ? fmtTokens(summary.total_input_tokens) : "—"}
                </span>
                <span>
                  <i className={styles.legendDotOutput} aria-hidden />
                  Output{" "}
                  {summary ? fmtTokens(summary.total_output_tokens) : "—"}
                </span>
              </div>
            </div>
            <div className={styles.statGrid}>
              <StatPair
                label="Mean cost / run"
                value={
                  summary?.mean_cost_usd == null
                    ? "—"
                    : fmtCost(summary.mean_cost_usd)
                }
                hint="Average estimated cost per completed run"
              />
              <StatPair
                label="Total cost"
                value={summary ? fmtCost(summary.total_cost_usd) : "—"}
                hint="Cumulative estimated spend, all-time"
              />
            </div>
            <p className={styles.note}>
              Tokens and cost come from LangGraph LLM calls (domain narration +
              orchestrator). Ollama and mock record $0. KPIs aggregate the
              local <code>ai_ops_events</code> log — demo reset clears
              incident state, not this history. Optional LangSmith traces
              (when configured) are for per-run debugging only
              {summary?.langsmith_project
                ? ` (“${summary.langsmith_project}”)`
                : ""}
              .
            </p>
          </div>
        </section>
      </div>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Provider comparison</h2>
          <p className={styles.panelSubtitle}>
            Measured rows come from assessment events; unavailable and not-run rows keep their numbers blank
          </p>
        </header>
        <div className={styles.panelBody}>
          {summary?.providers && summary.providers.length > 0 ? (
            <div className={styles.tableWrap}>
              <table className={styles.eventsTable}>
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Model</th>
                    <th>Status</th>
                    <th>Assessments</th>
                    <th>Latency p50/p95</th>
                    <th>Avg latency</th>
                    <th>Tokens</th>
                    <th>Cost / run</th>
                    <th>Failure rate</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.providers.map((row) => (
                    <tr key={row.provider} data-status={row.status}>
                      <td>{providerTitle(row.provider)}</td>
                      <td>{row.model ?? "Not available"}</td>
                      <td>
                        <span
                          className={styles.statusChip}
                          data-status={row.status}
                          title={row.note ?? undefined}
                        >
                          {row.status === "measured"
                            ? "Measured"
                            : row.status === "not_run"
                              ? "Not run"
                              : row.connection_status}
                        </span>
                      </td>
                      <td>
                        {row.assessment_count > 0
                          ? `${row.complete_count}/${row.assessment_count} complete`
                          : "Not measured"}
                      </td>
                      <td>
                        {row.p50_latency_ms == null && row.p95_latency_ms == null
                          ? "Not measured"
                          : `${fmtLatency(row.p50_latency_ms)} / ${fmtLatency(
                              row.p95_latency_ms,
                            )}`}
                      </td>
                      <td>{fmtLatency(row.mean_latency_ms)}</td>
                      <td>
                        {row.total_tokens == null
                          ? "Not measured"
                          : fmtTokens(row.total_tokens)}
                      </td>
                      <td>
                        {row.mean_cost_usd == null
                          ? "Not measured"
                          : fmtCost(row.mean_cost_usd)}
                      </td>
                      <td>
                        {row.failure_rate == null
                          ? "Not measured"
                          : pct(row.failure_rate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.note}>Provider comparison is not available yet.</p>
          )}
        </div>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Recent assessments</h2>
          <p className={styles.panelSubtitle}>
            Every run stamped with the provider and model that produced it
            {provider?.source === "runtime_override"
              ? ` · runtime override: ${provider.active_provider} (in-process, resets on restart)`
              : ""}
          </p>
        </header>
        <div className={styles.panelBody}>
          {events && events.length > 0 ? (
            <div className={styles.tableWrap}>
              <table className={styles.eventsTable}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Status</th>
                    <th>Provider</th>
                    <th>Model</th>
                    <th>Latency</th>
                    <th>Tokens</th>
                    <th>Cost</th>
                    <th>Retrieval</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.assessment_id} data-status={e.status}>
                      <td title={e.recorded_at}>
                        {new Date(e.recorded_at).toLocaleTimeString()}
                      </td>
                      <td>
                        <span
                          className={styles.statusChip}
                          data-status={e.status}
                        >
                          {e.status}
                          {e.degraded ? " · degraded" : ""}
                        </span>
                      </td>
                      <td>{e.provider}</td>
                      <td>{e.model ?? "—"}</td>
                      <td>{fmtLatency(e.latency_ms)}</td>
                      <td>{fmtTokens(e.tokens_in + e.tokens_out)}</td>
                      <td>{fmtCost(e.cost_usd)}</td>
                      <td>
                        {e.retrieval_mode ?? "—"}
                        {e.retrieval_score != null
                          ? ` (${e.retrieval_score.toFixed(2)})`
                          : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.note}>
              No assessments recorded yet — run a scenario from Demo to
              populate this log.
            </p>
          )}
        </div>
      </section>

      <p className={styles.sourceNote}>
        Source: local database
        {summary?.persists_across_demo_reset
          ? " · all-time history (not cleared on demo reset)"
          : ""}
        {tracingOn ? " · optional LangSmith tracing for run-level traces" : ""}
      </p>
    </div>
  );
}
