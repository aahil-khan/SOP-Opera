"use client";

import { EvalScorecardView } from "@/components/eval/CompoundScorecard";
import { HandoverCoverage } from "@/components/eval/HandoverCoverage";

export default function EvalPage() {
  return (
    <>
      <EvalScorecardView />
      <HandoverCoverage />
    </>
  );
}
