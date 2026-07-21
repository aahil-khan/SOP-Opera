"use client";

import { useCallback, useEffect, useState } from "react";
import { ThresholdEditor } from "@/components/eval/ThresholdEditor";
import { ThemePicker } from "@/components/theme/ThemePicker";
import { useDndMode } from "@/lib/dndMode";
import { useLiveStore } from "@/lib/liveStore";
import { dismissAllNotificationToasts } from "@/lib/notificationToast";
import { TopNavMenu } from "./TopNavMenu";
import styles from "./SettingsMenu.module.css";

export function SettingsMenu() {
  const dndEnabled = useDndMode((s) => s.enabled);
  const hydrateDnd = useDndMode((s) => s.hydrate);
  const setDndEnabled = useDndMode((s) => s.setEnabled);
  const markRead = useLiveStore((s) => s.markNotificationsRead);
  const refreshThresholds = useLiveStore((s) => s.refreshThresholds);

  const [thresholdsKey, setThresholdsKey] = useState(0);
  const [loadingThresholds, setLoadingThresholds] = useState(false);

  useEffect(() => {
    hydrateDnd();
  }, [hydrateDnd]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) return;
      setLoadingThresholds(true);
      void refreshThresholds()
        .then(() => setThresholdsKey((k) => k + 1))
        .catch(() => {})
        .finally(() => setLoadingThresholds(false));
    },
    [refreshThresholds],
  );

  const toggleDnd = () => {
    const next = !dndEnabled;
    if (next) {
      dismissAllNotificationToasts();
      markRead();
    }
    setDndEnabled(next);
  };

  return (
    <TopNavMenu
      label="Settings"
      panelClassName={styles.panel}
      onOpenChange={handleOpenChange}
    >
      <header className={styles.header}>
        <h2 className={styles.title}>Settings</h2>
        <p className={styles.subtitle}>Appearance, alerts, and sensor thresholds.</p>
      </header>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Appearance</h3>
        <ThemePicker />
      </section>

      <section className={styles.section}>
        <div className={styles.row}>
          <div className={styles.rowCopy}>
            <h3 className={styles.sectionTitle}>Do not disturb</h3>
            <p className={styles.hint}>
              Mute activity badges, toast popups, and alert sounds.
            </p>
          </div>
          <button
            type="button"
            className={styles.toggle}
            data-on={dndEnabled ? "true" : undefined}
            onClick={toggleDnd}
            aria-pressed={dndEnabled}
          >
            {dndEnabled ? "On" : "Off"}
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Thresholds</h3>
        <p className={styles.hint}>
          Sensor bands and rule limits from environment config — editable for
          this runtime session.
        </p>
        {loadingThresholds ? (
          <p className={styles.loading}>Loading thresholds…</p>
        ) : (
          <ThresholdEditor embedded key={thresholdsKey} />
        )}
      </section>
    </TopNavMenu>
  );
}
