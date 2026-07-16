import type { PlantFloor } from "@/shared/enums";

export const PLAN_SRC: Record<PlantFloor, string> = {
  ground: "/twin/new-frame.svg",
  first: "/twin/first-floor.svg",
  second: "/twin/second-floor.svg",
};

export const FLOOR_ORDER: PlantFloor[] = ["ground", "first", "second"];

export const FLOOR_LABELS: Record<PlantFloor, string> = {
  ground: "Ground",
  first: "First",
  second: "Second",
};

export function extractSvgInner(markup: string): string {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  const root = doc.documentElement;
  if (root.querySelector("parsererror")) {
    return "";
  }
  return Array.from(root.childNodes)
    .map((node) => new XMLSerializer().serializeToString(node))
    .join("");
}

/** Simple in-memory cache so overview + detail share one SVG fetch per floor. */
const schematicCache = new Map<string, string>();

/** Strip GPU-heavy SVG features for overview thumbnails and high-DPI perf mode. */
export function liteSchematic(inner: string): string {
  return inner
    .replace(/\sfilter="[^"]*"/gi, "")
    .replace(/<filter\b[^>]*>[\s\S]*?<\/filter>/gi, "")
    .replace(
      /<rect\b[^>]*fill="url\(#[^"]+\)"[^>]*opacity="0\.03"[^>]*\/>/gi,
      "",
    );
}

export async function loadFloorSchematic(
  floor: PlantFloor,
  options?: { lite?: boolean },
): Promise<string> {
  const key = options?.lite ? `${floor}:lite` : floor;
  const cached = schematicCache.get(key);
  if (cached != null) return cached;

  const res = await fetch(PLAN_SRC[floor]);
  if (!res.ok) throw new Error(`Failed to load ${PLAN_SRC[floor]}`);
  let inner = extractSvgInner(await res.text());
  if (options?.lite) inner = liteSchematic(inner);
  schematicCache.set(key, inner);
  return inner;
}
