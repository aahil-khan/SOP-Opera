"use client";

import { EvalScorecardView } from "@/components/eval/CompoundScorecard";
import { HandoverCoverage } from "@/components/eval/HandoverCoverage";
import styles from "./page.module.css";

export default function EvalPage() {
  return (
    <div className={styles.shell}>
      <EvalScorecardView />
      <div className={styles.below}>
        <HandoverCoverage />
      </div>
    </div>
  );
}
