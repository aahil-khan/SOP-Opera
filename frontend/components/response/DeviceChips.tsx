"use client";

import { useMemo } from "react";
import type { ResponseDevice } from "@/lib/liveApi";
import { useLiveStore } from "@/lib/liveStore";
import { deviceShortLabel, plainState } from "@/lib/autoResponse";
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
          title={`${d.label} — ${plainState(d.state) ?? d.state}`}
        >
          <span aria-hidden="true">{GLYPH[d.kind] ?? "●"}</span>
          {/* Same names and same state words as the panel — these used to
              disagree, so one device read "Tool gate closed" here and "Tool gate
              locked" three inches away. */}
          <span className={styles.text}>
            {deviceShortLabel(d.kind)} {plainState(d.state) ?? d.state}
          </span>
        </span>
      ))}
    </span>
  );
}
