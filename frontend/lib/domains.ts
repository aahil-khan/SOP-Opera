import type { LiveAssetView } from "@/lib/liveStore";
// Straight from the leaf module rather than through liveStore's re-export: that
// re-export pulls the whole store (and every component it touches) in behind it,
// which is the same cycle the responseLiveCount note below works around.
import type { SpatialLinkView } from "@/lib/spatialLinks";
import { spatialLinksFromAssessment } from "@/lib/spatialLinks";
import type { AreaOwner, RetrievedReference } from "@/shared/schemas";

export type DomainId =
  | "sensors"
  | "permits"
  | "people"
  | "evidence"
  | "response"
  | "spatial"
  | "history";

/**
 * `response` sits next to `evidence` on purpose: the two faces read as a pair,
 * what we knew and what we did about it.
 *
 * `history` is last because it is the only face that looks backwards — every
 * other domain describes the asset now. It became a face rather than a section
 * of its own because the inline list ran to 20 closures and 1578px, which was
 * 72% of the panel's scroll height and buried the six live faces above it.
 */
export const DOMAINS: DomainId[] = [
  "sensors",
  "permits",
  "people",
  "evidence",
  "response",
  "spatial",
  "history",
];

export interface DomainMeta {
  id: DomainId;
  label: string;
  short: string;
  /** CSS custom property name, e.g. --domain-sensors */
  colorVar: string;
}

export const DOMAIN_META: Record<DomainId, DomainMeta> = {
  sensors: {
    id: "sensors",
    label: "Sensors",
    short: "Live telemetry",
    colorVar: "--domain-sensors",
  },
  permits: {
    id: "permits",
    label: "Permits",
    short: "PTW & hot work",
    colorVar: "--domain-permits",
  },
  people: {
    id: "people",
    label: "People",
    short: "Crew & owner",
    colorVar: "--domain-people",
  },
  evidence: {
    id: "evidence",
    label: "Evidence",
    short: "Facts & refs",
    colorVar: "--domain-evidence",
  },
  response: {
    id: "response",
    label: "Response",
    short: "What the system did",
    colorVar: "--domain-response",
  },
  spatial: {
    id: "spatial",
    label: "Spatial",
    short: "Nearby links",
    colorVar: "--domain-spatial",
  },
  history: {
    id: "history",
    label: "History",
    short: "Prior closures",
    colorVar: "--domain-history",
  },
};

export interface DomainScore {
  domain: DomainId;
  /** 0–100, drives radar vertex distance from center */
  score: number;
  headline: string;
  facts: string[];
  warn: boolean;
  /** True when this domain has no backend/live signal to show */
  empty: boolean;
}

export interface DomainScoreExtras {
  /** Latest gas ppm from telemetry, if any */
  gasPpm?: number | null;
  /** Count of elevated telemetry metrics (above warnAt) */
  elevatedMetricCount?: number;
  /** Total metrics with data */
  metricCount?: number;
  /**
   * Neighbor count from `/graph/neighbors`.
   * `undefined` means not loaded yet — spatial is not marked empty until known.
   */
  neighborCount?: number;
  /** True while neighbor fetch is in flight */
  spatialPending?: boolean;
  /** Zone area owner when review detail is not loaded (nominal assets). */
  areaOwner?: AreaOwner | null;
  /**
   * Auto-response counts for this review.
   *
   * Passed in rather than read from the store: `liveStore` imports this module,
   * so importing it back would close the cycle that `liveStore.ts:81` already
   * works around. Same shape as `neighborCount` above.
   */
  responseLiveCount?: number;
  responseRefusedCount?: number;
  responseProtectCount?: number;
  /**
   * Closed report count for this asset. Same shape as `neighborCount` above:
   * fetched by the radar, `undefined` until it lands so the face is not marked
   * empty before we know.
   */
  historyCount?: number;
  /** True while the closure-report fetch is in flight. */
  historyPending?: boolean;
  /** Risk level of the most recent closure, for the face headline. */
  historyLastOutcome?: string | null;
  /**
   * The review this view is pinned to is over and the asset reads All clear.
   *
   * Four faces — permits, people, evidence, response — are computed from the
   * review, not from the asset. Without this they keep reporting a closed
   * review's permits, crew, facts and automatic actions as current, so an asset
   * can say "All clear" and "2 actions taken" at the same time. Set by the
   * radar from AssetPanel's `isHappy`.
   */
  reviewResolved?: boolean;
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function gasFromView(view: LiveAssetView): number | null {
  const context = view.detail?.context ?? [];
  const gasCtx = context.find(
    (c) =>
      c.category === "sensor" && typeof c.payload.gas_reading === "number",
  );
  return gasCtx ? (gasCtx.payload.gas_reading as number) : null;
}

function activePermits(view: LiveAssetView) {
  const context = view.detail?.context ?? [];
  return context.filter(
    (c) =>
      c.category === "permit" &&
      String(c.payload.status ?? "").toLowerCase() === "active",
  );
}

function crewCount(view: LiveAssetView): number {
  const context = view.detail?.context ?? [];
  return context.filter((c) => c.category === "worker_location").length;
}

function references(view: LiveAssetView): RetrievedReference[] {
  return view.assessment?.retrieved_references ?? [];
}

export function computeDomainScore(
  view: LiveAssetView,
  domain: DomainId,
  extras: DomainScoreExtras = {},
): DomainScore {
  const spatialLinks = spatialLinksFromAssessment(view.assessment);
  // Zero the review-derived inputs rather than short-circuiting each case: the
  // existing empty-state headline and facts are already the right copy.
  const resolved = extras.reviewResolved === true;

  switch (domain) {
    case "sensors": {
      const gas = extras.gasPpm ?? gasFromView(view);
      const elevated = extras.elevatedMetricCount ?? 0;
      const metrics = extras.metricCount ?? (gas != null ? 1 : 0);
      const empty = metrics === 0 && gas == null;
      const gasWarn = gas != null && gas >= 20;
      let score = 0;
      if (!empty) {
        score = 28 + Math.min(metrics, 6) * 8;
        if (elevated > 0 || gasWarn) score = Math.max(score, 55 + elevated * 12);
        if (gasWarn && gas != null && gas >= 35) score = Math.max(score, 90);
      }
      const facts: string[] = [];
      if (gas != null) facts.push(`Gas ${gas.toFixed(1)} ppm`);
      if (metrics > 0) facts.push(`${metrics} live metric${metrics === 1 ? "" : "s"}`);
      if (elevated > 0) facts.push(`${elevated} above warn`);
      return {
        domain,
        score: clampScore(score),
        headline: gasWarn
          ? "Elevated sensor readings"
          : metrics > 0
            ? "Telemetry nominal"
            : "No live telemetry",
        facts: facts.slice(0, 2),
        warn: gasWarn || elevated > 0,
        empty,
      };
    }
    case "permits": {
      const permits = resolved ? [] : activePermits(view);
      const empty = permits.length === 0;
      const hotWork = permits.some(
        (c) => String(c.payload.work_type ?? "") === "hot_work",
      );
      let score = 0;
      if (!empty) {
        score = 35 + permits.length * 18;
        if (hotWork) score = Math.max(score, 78);
      }
      return {
        domain,
        score: clampScore(score),
        headline:
          empty
            ? "No active permits"
            : hotWork
              ? "Hot work permit active"
              : `${permits.length} active permit${permits.length === 1 ? "" : "s"}`,
        facts: empty
          ? ["PTW clear"]
          : [
              `${permits.length} active`,
              ...(hotWork ? ["Hot work"] : []),
            ].slice(0, 2),
        warn: !empty,
        empty,
      };
    }
    case "people": {
      const crew = resolved ? 0 : crewCount(view);
      // The zone owner is fetched per asset, not per review, so it survives a
      // closure; only the review's worker_location entries are dropped.
      const owner = resolved
        ? (extras.areaOwner ?? null)
        : (view.detail?.area_owner ?? extras.areaOwner ?? null);
      const empty = crew === 0 && !owner;
      let score = 0;
      if (!empty) {
        if (owner) score += 25;
        if (crew > 0) score += 30 + Math.min(crew, 4) * 10;
        score = Math.max(score, 20);
      }
      return {
        domain,
        score: clampScore(score),
        headline:
          crew > 0
            ? `${crew} in zone`
            : owner
              ? `Owner · ${owner.name}`
              : "No crew nearby",
        facts: [
          ...(owner ? [`${owner.name}`] : []),
          crew > 0 ? `${crew} worker${crew === 1 ? "" : "s"}` : "Clear",
        ].slice(0, 2),
        warn: crew > 0,
        empty,
      };
    }
    case "evidence": {
      const facts = resolved ? [] : (view.detail?.derived_facts ?? []);
      const refs = resolved ? [] : references(view);
      const n = facts.length + refs.length;
      const empty = n === 0;
      const score = empty
        ? 0
        : clampScore(25 + facts.length * 12 + refs.length * 10);
      return {
        domain,
        score,
        headline: empty
          ? "No evidence yet"
          : `${facts.length} fact${facts.length === 1 ? "" : "s"} · ${refs.length} ref${refs.length === 1 ? "" : "s"}`,
        facts: [
          ...(facts.length ? [`${facts.length} derived`] : []),
          ...(refs.length
            ? [`${refs.length} retrieved`]
            : empty
              ? []
              : ["Awaiting retrieval"]),
        ].slice(0, 2),
        warn: facts.length > 0,
        empty,
      };
    }
    case "response": {
      const live = resolved ? 0 : (extras.responseLiveCount ?? 0);
      const refused = resolved ? 0 : (extras.responseRefusedCount ?? 0);
      const protect = resolved ? 0 : (extras.responseProtectCount ?? 0);
      // Refusals alone are not activity: a review where the system only
      // declined things has done nothing to the plant and should read empty.
      const empty = live === 0;
      let score = 0;
      if (!empty) {
        score = 30 + Math.min(live, 8) * 7;
        if (protect > 0) score = Math.max(score, 70 + protect * 5);
      }
      const facts: string[] = [];
      if (protect > 0) facts.push(`${protect} made it safer`);
      if (refused > 0) facts.push(`${refused} need a person`);
      return {
        domain,
        score: clampScore(score),
        headline: empty
          ? "Nothing automatic yet"
          : `${live} action${live === 1 ? "" : "s"} taken`,
        facts: facts.slice(0, 2),
        warn: protect > 0,
        empty,
      };
    }
    case "spatial": {
      const neighbors = extras.neighborCount ?? 0;
      const pending = extras.spatialPending === true;
      const n = spatialLinks.length + neighbors;
      // Don't grey out while neighbors are still loading — KG near/above
      // is the primary signal for most assets without an assessment yet.
      const empty = !pending && n === 0;
      let score = 0;
      if (pending && n === 0) {
        score = 18;
      } else if (!empty) {
        score =
          30 + spatialLinks.length * 20 + Math.min(neighbors, 6) * 6;
        if (spatialLinks.length > 0) score = Math.max(score, 65);
        if (neighbors > 0) score = Math.max(score, 40);
      }
      return {
        domain,
        score: clampScore(score),
        headline: pending && n === 0
          ? "Checking nearby assets…"
          : spatialLinks.length > 0
            ? spatialLinks[0]?.reason?.slice(0, 48) || "Spatial co-occurrence"
            : neighbors > 0
              ? `${neighbors} nearby asset${neighbors === 1 ? "" : "s"}`
              : "No spatial links",
        facts: [
          ...(spatialLinks.length
            ? [`${spatialLinks.length} co-occur`]
            : []),
          ...(neighbors > 0
            ? [`${neighbors} near/above`]
            : pending
              ? ["Loading…"]
              : empty
                ? []
                : ["Isolated"]),
        ].slice(0, 2),
        warn: spatialLinks.length > 0,
        empty,
      };
    }
    case "history": {
      const count = extras.historyCount ?? 0;
      const pending = extras.historyPending === true;
      // Don't grey out while the fetch is in flight — same treatment spatial
      // gives neighbours, so the face doesn't flicker empty then fill.
      const empty = !pending && count === 0;
      const last = extras.historyLastOutcome ?? null;
      let score = 0;
      if (pending && count === 0) {
        score = 18;
      } else if (!empty) {
        // Depth of record, not severity: a long clean history is a well-run
        // asset, so this face must never read as a live hazard.
        score = clampScore(25 + Math.min(count, 12) * 6);
      }
      return {
        domain,
        score,
        headline: pending && count === 0
          ? "Checking prior closures…"
          : empty
            ? "No prior issues on file"
            : `${count} prior closure${count === 1 ? "" : "s"}`,
        facts: [
          ...(count > 0 ? [`${count} on file`] : []),
          ...(last
            ? [`Last: ${last.replace(/_/g, " ")}`]
            : pending
              ? ["Loading…"]
              : []),
        ].slice(0, 2),
        // Always false: this face reports what already closed. A past blocking
        // decision is a resolved event, and amber here would compete with the
        // six live faces for the supervisor's attention.
        warn: false,
        empty,
      };
    }
  }
}

export function computeAllDomainScores(
  view: LiveAssetView,
  extras: DomainScoreExtras = {},
): DomainScore[] {
  return DOMAINS.map((d) => computeDomainScore(view, d, extras));
}

export function domainColorCss(domain: DomainId): string {
  return `var(${DOMAIN_META[domain].colorVar})`;
}

export function spatialLinksForView(view: LiveAssetView): SpatialLinkView[] {
  return spatialLinksFromAssessment(view.assessment);
}
