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
const schematicCache = new Map<PlantFloor, string>();

export async function loadFloorSchematic(floor: PlantFloor): Promise<string> {
  const cached = schematicCache.get(floor);
  if (cached != null) return cached;

  const res = await fetch(PLAN_SRC[floor]);
  if (!res.ok) throw new Error(`Failed to load ${PLAN_SRC[floor]}`);
  const inner = extractSvgInner(await res.text());
  schematicCache.set(floor, inner);
  return inner;
}
