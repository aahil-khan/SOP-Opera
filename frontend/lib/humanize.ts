/**
 * Plain-English helpers shared by every operator-facing surface.
 *
 * These used to live inside `components/reviews/IssueReport.tsx`; the closure
 * report needs the same prose treatment, so they moved here rather than being
 * duplicated. No surface should print a raw ISO timestamp or a bare UUID.
 */

import type { RetrievedReference } from "@/shared/schemas";

export function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

export function refLabel(r: RetrievedReference): string {
  if (r.code && r.title) return `${r.code}: ${r.title}`;
  if (r.title) return r.title;
  return r.source.replaceAll("_", " ");
}

/** Display label for a frozen report citation card. */
export function citationLabel(c: {
  source?: string | null;
  code?: string | null;
  title?: string | null;
  snippet?: string | null;
}): string {
  const genericIncident = c.title === "Historical incident";
  if (c.code && c.title && !genericIncident) return `${c.code}: ${c.title}`;
  if (c.title && !genericIncident) return c.title;
  if (c.code) return c.code;
  const snippet = c.snippet?.trim();
  if (snippet) {
    return snippet.length <= 120 ? snippet : `${snippet.slice(0, 117).trimEnd()}…`;
  }
  if (c.title) return c.title;
  return (c.source ?? "reference").replaceAll("_", " ");
}

/** Drop internal architecture jargon from operator-facing copy. */
export function humanizeDetail(text: string, fallbackTitle: string): string {
  const derived = text.match(
    /^Derived fact ['"]?([a-z0-9_]+)['"]? is active on (.+)\.?$/i,
  );
  if (derived) {
    const asset = derived[2]?.replace(/\.$/, "") ?? "this asset";
    return `${fallbackTitle} is active on ${asset}.`;
  }
  return text;
}

export function scrubAgentTitle(point: string): string {
  return point.replace(
    /:\s*(?:SCADA\s*\/\s*Sensor|Permit\s*\/\s*PTW|Maintenance|Workforce\s*\/\s*Zone|Spatial|Incident|Handover|Forecast)\s*Agent:\s*/i,
    ": ",
  );
}

export function isClearancePoint(point: string): boolean {
  const lower = point.toLowerCase();
  return (
    lower.includes("no active hazards") ||
    lower.includes("no hot-work") ||
    lower.includes("no co-occurrence") ||
    lower.includes("no imminent threshold") ||
    lower.includes("nothing to report") ||
    /:\s*no\b/.test(lower)
  );
}

export function splitSummary(summary: string): { lead: string; points: string[] } {
  const lines = summary
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length >= 2) {
    return {
      lead: lines[0]!,
      points: lines
        .slice(1)
        .map((l) => l.replace(/^[•\-\*]\s*/, ""))
        .map(scrubAgentTitle)
        .filter((p) => !isClearancePoint(p)),
    };
  }

  // Legacy jammed summaries: "Lead. Label: note Label: note"
  const single = summary.trim();
  const labelRe =
    /\b(?:Sensors|Permits|Maintenance|Crew|Nearby area|Past incidents|Shift notes|Forecast|SCADA|Permit|Spatial|Workforce|Incident|Handover):/g;
  const firstLabel = labelRe.exec(single);
  if (firstLabel && firstLabel.index != null && firstLabel.index > 0) {
    const lead = single.slice(0, firstLabel.index).trim();
    const rest = single.slice(firstLabel.index).trim();
    labelRe.lastIndex = 0;
    const parts: string[] = [];
    let match: RegExpExecArray | null;
    const starts: number[] = [];
    while ((match = labelRe.exec(rest)) != null) {
      starts.push(match.index);
    }
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i]!;
      const end = starts[i + 1] ?? rest.length;
      parts.push(rest.slice(start, end).trim());
    }
    const points = parts
      .filter(Boolean)
      .map((p) =>
        p
          .replace(/^SCADA:\s*/i, "Sensors: ")
          .replace(/^Spatial:\s*/i, "Nearby area: ")
          .replace(/^Workforce:\s*/i, "Crew: ")
          .replace(/^Incident:\s*/i, "Past incidents: ")
          .replace(/^Handover:\s*/i, "Shift notes: ")
          .replace(/^Permit:\s*/i, "Permits: "),
      )
      .map(scrubAgentTitle)
      .filter((p) => !isClearancePoint(p));
    if (lead && points.length > 0) return { lead, points };
    if (lead) return { lead, points: [] };
  }

  return { lead: single, points: [] };
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "14 Mar 2026" */
export function formatDate(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return "—";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "14 Mar 2026, 09:42" */
export function formatDateTime(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return "—";
  return `${formatDate(iso)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "2h 14m" — coarse by design; reports are read, not stopwatched. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

/** First `n` characters of a hash, ellipsised — hashes are checked, not read. */
export function shortHash(
  hash: string | null | undefined,
  n = 12,
): string {
  if (!hash) return "—";
  return hash.length <= n ? hash : `${hash.slice(0, n)}…`;
}
