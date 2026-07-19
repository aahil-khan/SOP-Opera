"use client";

import { useCallback, useState } from "react";
import {
  HandoverBriefPanel,
} from "@/components/handover/ShiftHandoverView";
import type { ShiftHandoverBrief } from "@/lib/liveApi";
import styles from "./ShiftGate.module.css";

const SESSION_KEY = "sop-opera-shift-started";

export function hasStartedShift(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return true;
  }
}

export function markShiftStarted(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
}

interface ShiftGateProps {
  onStartShift: (attentionAssetId: string | null) => void;
}

export function ShiftGate({ onStartShift }: ShiftGateProps) {
  const [brief, setBrief] = useState<ShiftHandoverBrief | null>(null);

  const handleReady = useCallback((data: ShiftHandoverBrief) => {
    setBrief(data);
  }, []);

  const start = useCallback(() => {
    markShiftStarted();
    const assetId = brief?.attention_asset_id ?? null;
    onStartShift(assetId);
  }, [brief, onStartShift]);

  const skip = useCallback(() => {
    markShiftStarted();
    onStartShift(null);
  }, [onStartShift]);

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Shift handover">
      <div className={styles.panel}>
        <header className={styles.header}>
          <p className={styles.mark}>Shift start</p>
          <h2 className={styles.title}>Overnight handover</h2>
          <p className={styles.subtitle}>
            Preview open work before you enter the twin — then start your shift
            on the asset that needs attention.
          </p>
        </header>

        <div className={styles.body}>
          <HandoverBriefPanel
            autoFetch
            compact
            showControls={false}
            onReady={handleReady}
            onSelectAsset={(assetId) => {
              markShiftStarted();
              onStartShift(assetId);
            }}
          />
        </div>

        <footer className={styles.footer}>
          <button type="button" className={styles.skip} onClick={skip}>
            Skip to twin
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={start}
            disabled={!brief}
          >
            Start shift
          </button>
        </footer>
      </div>
    </div>
  );
}
