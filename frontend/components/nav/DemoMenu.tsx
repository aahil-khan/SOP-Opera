"use client";

import { DemoControls } from "@/components/demo/DemoControls";
import { useDemoStatus } from "@/lib/useDemoStatus";
import { TopNavMenu } from "./TopNavMenu";
import styles from "./DemoMenu.module.css";

export function DemoMenu() {
  const { status } = useDemoStatus();

  return (
    <TopNavMenu
      label="Demo"
      panelClassName={styles.panel}
      indicator={Boolean(status?.ambient_running)}
      indicatorLabel="Ambient plant telemetry is streaming"
    >
      <DemoControls variant="panel" />
    </TopNavMenu>
  );
}
