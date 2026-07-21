/**
 * Zone slugs (`coke-oven-battery`) → human labels ("Coke Oven Battery").
 *
 * `zone_owners.zone` and `assets.zone` are stored as slugs; the roster returns
 * them verbatim in `RosterEntry.owned_zones`.
 */

/** Slugs whose title-cased form reads wrong. */
const SPECIAL_CASE: Record<string, string> = {
  etp: "ETP",
  dri: "DRI",
  hvac: "HVAC",
  scada: "SCADA",
};

export function zoneLabel(zone: string): string {
  return zone
    .split("-")
    .map((word) => {
      const special = SPECIAL_CASE[word.toLowerCase()];
      if (special) return special;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * "Coke Oven Battery · DRI Plant +2 more" — keeps identity rows to one line.
 * Returns null for an empty list so callers can fall back to a role label.
 */
export function zoneSummary(zones: string[], max = 2): string | null {
  if (zones.length === 0) return null;
  const shown = zones.slice(0, max).map(zoneLabel).join(" · ");
  const rest = zones.length - max;
  return rest > 0 ? `${shown} +${rest} more` : shown;
}
