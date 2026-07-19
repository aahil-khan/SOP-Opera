import type { LiveAssetView, SpatialLinkView } from "@/lib/liveStore";
import { spatialLinksFromAssessment } from "@/lib/liveStore";
import type { RetrievedReference } from "@/shared/schemas";

export type DomainId =
  | "sensors"
  | "permits"
  | "people"
  | "evidence"
  | "spatial";

export const DOMAINS: DomainId[] = [
  "sensors",
  "permits",
  "people",
  "evidence",
  "spatial",
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
  spatial: {
    id: "spatial",
    label: "Spatial",
    short: "Nearby links",
    colorVar: "--domain-spatial",
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
  /** Neighbor count from KG API (optional enrichment) */
  neighborCount?: number;
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
      const permits = activePermits(view);
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
      const crew = crewCount(view);
      const owner = view.detail?.area_owner ?? null;
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
      const facts = view.detail?.derived_facts ?? [];
      const refs = references(view);
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
    case "spatial": {
      const neighbors = extras.neighborCount ?? 0;
      const n = spatialLinks.length + neighbors;
      const empty = n === 0;
      let score = 0;
      if (!empty) {
        score =
          30 + spatialLinks.length * 20 + Math.min(neighbors, 6) * 6;
        if (spatialLinks.length > 0) score = Math.max(score, 65);
      }
      return {
        domain,
        score: clampScore(score),
        headline:
          spatialLinks.length > 0
            ? spatialLinks[0]?.reason?.slice(0, 48) || "Spatial co-occurrence"
            : neighbors > 0
              ? `${neighbors} nearby asset${neighbors === 1 ? "" : "s"}`
              : "No spatial links",
        facts: [
          ...(spatialLinks.length
            ? [`${spatialLinks.length} co-occur`]
            : []),
          ...(neighbors > 0 ? [`${neighbors} near`] : empty ? [] : ["Isolated"]),
        ].slice(0, 2),
        warn: spatialLinks.length > 0,
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
