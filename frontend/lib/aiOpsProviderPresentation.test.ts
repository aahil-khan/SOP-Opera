import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalProvider,
  providerStatusTone,
  providerTitle,
} from "./aiOpsProviderPresentation";

test("provider titles are operator-readable", () => {
  assert.equal(providerTitle("ollama"), "Ollama");
  assert.equal(providerTitle("openai_compatible"), "OpenAI Compatible");
  assert.equal(providerTitle("mock"), "Mock");
});

test("langgraph-stamped runs title as the provider they used", () => {
  // agents/graph.py stamps `langgraph:<provider>`; the comparison table folds
  // those in, so the per-run list must name them the same way or the two
  // tables disagree about which provider produced the run.
  assert.equal(providerTitle("langgraph:openai_compatible"), "OpenAI Compatible");
  assert.equal(providerTitle("langgraph:mock"), "Mock");
  assert.equal(providerTitle("openai"), "OpenAI Compatible");
  assert.equal(providerTitle(null), "-");
  assert.equal(providerTitle("something_else"), "something_else");
});

test("canonicalProvider folds path prefixes and legacy spellings", () => {
  assert.equal(canonicalProvider("langgraph:openai_compatible"), "openai_compatible");
  assert.equal(canonicalProvider("openai"), "openai_compatible");
  assert.equal(canonicalProvider("mock"), "mock");
  assert.equal(canonicalProvider(null), "mock");
});

test("provider status tones distinguish connected and failed checks", () => {
  assert.equal(providerStatusTone("connected", true), "good");
  assert.equal(providerStatusTone("not_run", true), "neutral");
  assert.equal(providerStatusTone("unconfigured", false), "bad");
  assert.equal(providerStatusTone("missing_model", false), "bad");
});
