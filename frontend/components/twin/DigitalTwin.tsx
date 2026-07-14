"use client";

import { useDemoStore } from "@/lib/demoStore";
import type { RiskLevel } from "@/shared/enums";
import { FloorPlan } from "./FloorPlan";
import { AssetPanel } from "./AssetPanel";
import { ReviewSidebar } from "./ReviewSidebar";
import styles from "./DigitalTwin.module.css";

export function DigitalTwin() {
  const runtimes = useDemoStore((s) => s.runtimes);
  const selectedAssetId = useDemoStore((s) => s.selectedAssetId);
  const selectAsset = useDemoStore((s) => s.selectAsset);
  const isPlaying = useDemoStore((s) => s.isPlaying);
  const activeScenario = useDemoStore((s) => s.activeScenario);

  const riskByAsset: Record<string, RiskLevel> = {};
  for (const [id, rt] of Object.entries(runtimes)) {
    riskByAsset[id] = rt.risk_level;
  }

  const selected = selectedAssetId ? runtimes[selectedAssetId] : null;

  return (
    <div className={styles.wrap}>
      <aside className={styles.left}>
        <ReviewSidebar />
      </aside>

      <div className={styles.center}>
        <div className={styles.legend}>
          <span>
            <span
              className={styles.swatch}
              style={{ background: "var(--risk-nominal)" }}
            />
            Nominal
          </span>
          <span>
            <span
              className={styles.swatch}
              style={{ background: "var(--risk-elevated)" }}
            />
            Elevated
          </span>
          <span>
            <span
              className={styles.swatch}
              style={{ background: "var(--risk-blocking)" }}
            />
            Blocking
          </span>
          {activeScenario && (
            <span className={styles.scenarioTag}>
              Scenario: <code>{activeScenario}</code>
              {isPlaying ? " · playing…" : " · idle"}
            </span>
          )}
        </div>

        <div className={styles.stage}>
          <FloorPlan
            riskByAsset={riskByAsset}
            selectedAssetId={selectedAssetId}
            onSelectAsset={selectAsset}
          />
          {selected && (
            <AssetPanel
              runtime={selected}
              onClose={() => selectAsset(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
