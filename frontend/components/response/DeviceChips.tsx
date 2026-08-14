"use client";

import { useMemo } from "react";
import type { ResponseDevice } from "@/lib/liveApi";
import { useLiveStore } from "@/lib/liveStore";
import styles from "./DeviceChips.module.css";

/**
 * Response equipment for one zone, rendered on the floor plan.
 *
 * Only devices that have actually moved off their default state are shown.
 * Painting every fan and gate in the plant permanently would make the moment
 * one of them changes invisible, which is the only moment that matters.
 */

const GLYPH: Record<string, string> = {
  ventilation: "≋",
  pa_zone: "◉",
  exclusion_signage: "▣",
  tool_issuance_gate: "⛔",
  muster_alarm: "◬",
  permit_gate: "⧉",
};

const SHORT: Record<string, string> = {
  ventilation: "Ventilation",
  pa_zone: "PA",
  exclusion_signage: "Signage",
  tool_issuance_gate: "Tool gate",
  muster_alarm: "Muster",
  permit_gate: "Permit",
};

export function DeviceChips({ zone }: { zone: string | null | undefined }) {
  const devices = useLiveStore((s) => s.responseDevices);

  const engaged = useMemo(
    () =>
      devices.filter(
        (d: ResponseDevice) => d.zone === zone && d.state !== d.default_state,
      ),
    [devices, zone],
  );

  if (!zone || engaged.length === 0) return null;

  return (
    <span className={styles.chips} aria-label="Automatic response equipment">
      {engaged.map((d) => (
        <span
          key={d.id}
          className={styles.chip}
          title={`${d.label} — ${d.state}${d.simulated ? " (simulated)" : ""}`}
        >
          <span aria-hidden="true">{GLYPH[d.kind] ?? "●"}</span>
          <span className={styles.text}>
            {SHORT[d.kind] ?? d.kind} {d.state}
          </span>
        </span>
      ))}
    </span>
  );
}
