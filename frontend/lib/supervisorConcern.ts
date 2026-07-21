import type { RiskLevel } from "@/shared/enums";

export type SupervisorConcernType =
  | "safety_hazard"
  | "equipment"
  | "permit_isolation"
  | "environmental"
  | "personnel"
  | "other";

export const SUPERVISOR_CONCERN_OPTIONS: Array<{
  value: SupervisorConcernType;
  label: string;
  hint: string;
}> = [
  {
    value: "safety_hazard",
    label: "Safety hazard",
    hint: "Immediate risk to people or process safety",
  },
  {
    value: "equipment",
    label: "Equipment issue",
    hint: "Abnormal readings, damage, or malfunction",
  },
  {
    value: "permit_isolation",
    label: "Permit / isolation",
    hint: "PTW, LOTO, or isolation concern",
  },
  {
    value: "environmental",
    label: "Environmental",
    hint: "Spill, emissions, or effluent concern",
  },
  {
    value: "personnel",
    label: "Personnel",
    hint: "Crew behavior, PPE, or certification issue",
  },
  {
    value: "other",
    label: "Other",
    hint: "Something else that needs operator review",
  },
];

const CONCERN_LABELS: Record<SupervisorConcernType, string> = {
  safety_hazard: "Safety hazard",
  equipment: "Equipment issue",
  permit_isolation: "Permit / isolation",
  environmental: "Environmental",
  personnel: "Personnel",
  other: "Other",
};

export function labelSupervisorConcern(type: string | null | undefined): string {
  if (!type) return "Floor issue";
  return CONCERN_LABELS[type as SupervisorConcernType] ?? type.replaceAll("_", " ");
}

export function riskForSupervisorConcern(type: string | null | undefined): RiskLevel {
  return type === "safety_hazard" ? "blocking" : "elevated";
}
