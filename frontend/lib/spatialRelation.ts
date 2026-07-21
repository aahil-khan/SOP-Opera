import type { PlantFloor } from "@/shared/enums";

const FLOOR_ORDER: Record<PlantFloor, number> = {
  ground: 0,
  first: 1,
  second: 2,
};

/** Resolve stored KG relation (NEAR | ABOVE) relative to a focus asset's floor. */
export function relationRelativeToFocus(
  relation: string,
  focusFloor: PlantFloor,
  otherFloor: PlantFloor,
): string {
  if (relation !== "ABOVE") return relation;
  const focus = FLOOR_ORDER[focusFloor] ?? 0;
  const other = FLOOR_ORDER[otherFloor] ?? 0;
  if (focus === other) return "NEAR";
  return focus < other ? "ABOVE" : "BELOW";
}

export function otherAssetIdInLink(
  focusAssetId: string,
  link: { from_asset_id: string; to_asset_id: string },
): string {
  return link.from_asset_id === focusAssetId
    ? link.to_asset_id
    : link.from_asset_id;
}

export function otherLabelInLink(
  focusAssetId: string,
  link: { from_asset_id: string; to_asset_id: string; from_label: string; to_label: string },
): string {
  return link.from_asset_id === focusAssetId ? link.to_label : link.from_label;
}
