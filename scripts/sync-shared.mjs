#!/usr/bin/env node
/**
 * Copy TypeScript contracts + fixtures into frontend/shared.
 * Turbopack forbids symlinks / imports that escape the Next.js project root.
 * Cross-platform (Windows / macOS / Linux) — no bash required.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const destDir = join(root, "frontend", "shared");
const files = ["enums.ts", "schemas.ts", "api_contracts.ts", "fixtures.json"];

mkdirSync(destDir, { recursive: true });
for (const name of files) {
  copyFileSync(join(root, "shared", name), join(destDir, name));
}

// The plant floor plan is the only geometry source in the product, and the
// frontend needs its own copy for the same Turbopack reason. It was previously
// hand-duplicated with nothing keeping the two in sync, so the knowledge graph
// and the twin could silently disagree about where assets are.
copyFileSync(
  join(root, "backend", "app", "graph", "floor_plan_map.json"),
  join(root, "frontend", "lib", "floor_plan_map.json"),
);

console.log("synced shared → frontend/shared (+ floor_plan_map.json → frontend/lib)");
