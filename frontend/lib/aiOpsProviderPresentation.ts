export type Tone = "good" | "warn" | "bad" | "neutral";

export function providerTitle(provider: string | null | undefined): string {
  if (provider === "openai_compatible") return "OpenAI Compatible";
  if (provider === "ollama") return "Ollama";
  if (provider === "mock") return "Mock";
  return provider ?? "-";
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
