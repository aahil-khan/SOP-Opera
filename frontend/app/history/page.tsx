"use client";

import { HistoryDashboard } from "@/components/history/HistoryDashboard";
import styles from "./page.module.css";

export default function HistoryPage() {
  return (
    <div className={styles.shell}>
      <HistoryDashboard />
    </div>
  );
}
