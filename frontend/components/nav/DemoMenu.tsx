"use client";

import { DemoControls } from "@/components/demo/DemoControls";
import { TopNavMenu } from "./TopNavMenu";
import styles from "./DemoMenu.module.css";

export function DemoMenu() {
  return (
    <TopNavMenu label="Demo" panelClassName={styles.panel}>
      <DemoControls variant="panel" />
    </TopNavMenu>
  );
}
