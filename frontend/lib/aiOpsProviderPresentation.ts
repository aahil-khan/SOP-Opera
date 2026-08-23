export type Tone = "good" | "warn" | "bad" | "neutral";

/**
 * Fold a stored provider label onto its canonical key.
 *
 * Mirrors `canonical_provider()` in backend/app/assessment/provider_state.py:
 * runs are stamped with the path that produced them, so the agent graph writes
 * `langgraph:<provider>`, and `openai` is a legacy spelling of
 * `openai_compatible`. Both name the same provider.
 */
export function canonicalProvider(
  provider: string | null | undefined,
): string {
  const name = (provider ?? "mock").toLowerCase();
  const bare = name.startsWith("langgraph:")
    ? name.slice("langgraph:".length)
    : name;
  return bare === "openai" ? "openai_compatible" : bare;
}

export function providerTitle(provider: string | null | undefined): string {
  if (provider == null || provider === "") return "-";
  const key = canonicalProvider(provider);
  if (key === "openai_compatible") return "OpenAI Compatible";
  if (key === "ollama") return "Ollama";
  if (key === "mock") return "Mock";
  return provider;
}

export function providerStatusTone(
  status: string | null | undefined,
  ok?: boolean,
): Tone {
  if (
    status === "not_run" ||
    status === "configured" ||
    status === "available"
  ) {
    return "neutral";
  }
  if (ok === true || status === "measured" || status === "connected") {
    return "good";
  }
  if (
    ok === false ||
    status === "unavailable" ||
    status === "missing_model" ||
    status === "unconfigured"
  ) {
    return "bad";
  }
  return "neutral";
}
