"""
Fact -> recommended action mapping.

Each derived fact type maps to (recommendation, rationale). These are the
supervisor-facing actions attached to an assessment; the LLM narrates the
situation but does not invent the required action, so the same fact always
yields the same instruction.

Previously lived in `assessment/providers/mock.py` alongside a deterministic
"AI provider" that nothing called; that package has been removed, but this
mapping is live and is used by the orchestrator agent and the reasoning layer.
"""

from __future__ import annotations

FACT_RECOMMENDATIONS: dict[str, tuple[str, str]] = {
    "elevated_gas": (
        "Evacuate non-essential personnel and initiate gas detection confirmation sweep.",
        "Elevated gas readings exceed the safe working threshold for this zone.",
    ),
    "critical_gas": (
        "IMMEDIATE STOP WORK — gas has crossed the incident threshold. Evacuate, isolate ignition sources, and do not re-enter until atmosphere is verified safe.",
        "Gas reading is at or above the single-sensor critical/incident limit.",
    ),
    "permit_conflict": (
        "Suspend conflicting permits and reconcile work windows before restart.",
        "Active permits overlap incompatibly on this asset.",
    ),
    "zone_occupied": (
        "Clear the hazard zone and verify all personnel are accounted for.",
        "Workers are present in a zone flagged for elevated risk.",
    ),
    "incomplete_isolation": (
        "Complete isolation verification checklist before authorizing hot work.",
        "Isolation boundaries are incomplete or unverified.",
    ),
    "simultaneous_ops": (
        "Defer non-critical concurrent operations until primary work is secure.",
        "Simultaneous operations increase interaction risk on this asset.",
    ),
    "certification_expiring": (
        "Replace or re-certify workers whose credentials expire within the warning window.",
        "Worker certifications are approaching expiry during active work.",
    ),
    "over_temperature": (
        "Reduce firing rate and verify temperature instrumentation before continuing.",
        "Process temperature exceeds the safe operating band for this asset.",
    ),
    "critical_temperature": (
        "IMMEDIATE STOP WORK — process temperature crossed the incident threshold. Hold production and verify metal limits before restart.",
        "Temperature is at or above the single-sensor critical/incident limit.",
    ),
    "equipment_vibration_anomaly": (
        "Inspect rotating equipment and schedule vibration diagnosis immediately.",
        "Vibration severity is outside the accepted ISO operating band.",
    ),
    "effluent_quality_breach": (
        "Divert effluent to holding and do not discharge until quality is restored.",
        "Effluent pH is outside the permitted discharge band.",
    ),
    "tank_level_critical": (
        "Stop transfers and verify tank level instrumentation and overfill protection.",
        "Tank inventory is at a critical high or low setpoint.",
    ),
    "ppe_noncompliance": (
        "Stop entry until PPE is brought into compliance and re-brief the work party.",
        "A worker is missing required PPE for the zone hazard class.",
    ),
    "lifting_operation_conflict": (
        "Suspend overlapping lifts and restart under a single coordinated lift plan.",
        "Two or more active lifts share conflicting airspace.",
    ),
    "weather_hold": (
        "Hold hot work and outdoor lifts until weather all-clear is declared.",
        "Weather conditions breach site hold criteria with exposed work active.",
    ),
    "predicted_trend_risk": (
        "Increase monitoring and pre-stage isolation before thresholds are crossed.",
        "OLS trend projects a threshold crossing inside the forecast window.",
    ),
    "unacknowledged_handover": (
        "Walk this hazard through with the outgoing operator and acknowledge the handover item before authorizing work.",
        "A hazard on this asset crossed a shift boundary without the incoming operator acknowledging it.",
    ),
    "supervisor_safety_hazard": (
        "Treat as an active safety hazard — verify controls and hold work until the operator decides.",
        "A supervisor reported an immediate safety concern from the floor.",
    ),
    "supervisor_equipment_issue": (
        "Inspect the reported equipment and confirm readings before authorizing continued operation.",
        "A supervisor reported abnormal equipment behavior from the floor.",
    ),
    "supervisor_permit_issue": (
        "Review permits and isolation status against the supervisor's report before restart.",
        "A supervisor reported a permit or isolation concern from the floor.",
    ),
    "supervisor_environmental_issue": (
        "Contain and verify environmental controls before resuming affected work.",
        "A supervisor reported an environmental concern from the floor.",
    ),
    "supervisor_personnel_issue": (
        "Verify crew compliance and re-brief personnel before continuing work in the zone.",
        "A supervisor reported a personnel concern from the floor.",
    ),
    "supervisor_floor_report": (
        "Review the supervisor's floor report and decide whether work can continue.",
        "A supervisor flagged an issue that needs operator review.",
    ),
}
