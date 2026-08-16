import assert from "node:assert/strict";
import test from "node:test";

import {
  providerStatusTone,
  providerTitle,
} from "./aiOpsProviderPresentation";

test("provider titles are operator-readable", () => {
  assert.equal(providerTitle("ollama"), "Ollama");
  assert.equal(providerTitle("openai_compatible"), "OpenAI Compatible");
  assert.equal(providerTitle("mock"), "Mock");
});

test("provider status tones distinguish connected and failed checks", () => {
  assert.equal(providerStatusTone("connected", true), "good");
  assert.equal(providerStatusTone("not_run", true), "neutral");
  assert.equal(providerStatusTone("unconfigured", false), "bad");
  assert.equal(providerStatusTone("missing_model", false), "bad");
});
