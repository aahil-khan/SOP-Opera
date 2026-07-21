"use client";

import styles from "./MapLayerToggle.module.css";

export type MapLayerId = "ops";

interface MapLayerToggleProps {
  enabled: ReadonlySet<MapLayerId> | MapLayerId[];
  onToggle: (id: MapLayerId) => void;
  opsCount?: number;
  shiftForDrawer?: boolean;
}

export function MapLayerToggle({
  enabled,
  onToggle,
  opsCount = 0,
  shiftForDrawer = false,
}: MapLayerToggleProps) {
  const enabledSet =
    enabled instanceof Set ? enabled : new Set<MapLayerId>(enabled);
  const active = enabledSet.has("ops");

  return (
    <div
      className={styles.controls}
      data-shift={shiftForDrawer ? "true" : undefined}
      role="group"
      aria-label="Map layers"
    >
      <button
        type="button"
        className={styles.btn}
        data-active={active ? "true" : undefined}
        aria-pressed={active}
        title={
          active
            ? "Hide ops chips (permits, isolation, occupancy)"
            : "Show ops chips (permits, isolation, occupancy)"
        }
        onClick={() => onToggle("ops")}
      >
        <span className={styles.btnLabel}>Ops</span>
        {opsCount > 0 ? (
          <span className={styles.count} aria-label={`${opsCount} assets`}>
            {opsCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}
