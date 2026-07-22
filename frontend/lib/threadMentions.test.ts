import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMentionedWorkerIds } from "./threadMentions";
import type { RosterEntry } from "@/lib/authTypes";

const workers: RosterEntry[] = [
  {
    id: "55555555-5555-5555-5555-555555555551",
    kind: "worker",
    name: "Asha Rao",
    role: "Area Supervisor",
    owned_zones: [],
  },
  {
    id: "55555555-5555-5555-5555-555555555552",
    kind: "worker",
    name: "Imran Khan",
    role: "Area Supervisor",
    owned_zones: [],
  },
];

describe("parseMentionedWorkerIds", () => {
  it("resolves @Name tokens from comment body", () => {
    const ids = parseMentionedWorkerIds(
      "Please check @Asha Rao before restart",
      workers,
    );
    assert.deepEqual(ids, ["55555555-5555-5555-5555-555555555551"]);
  });

  it("resolves multiple mentions", () => {
    const ids = parseMentionedWorkerIds(
      "@Imran Khan and @Asha Rao — sync on LEL",
      workers,
    );
    assert.equal(ids.length, 2);
    assert.ok(ids.includes("55555555-5555-5555-5555-555555555551"));
    assert.ok(ids.includes("55555555-5555-5555-5555-555555555552"));
  });

  it("returns empty when no @ tokens match roster", () => {
    assert.deepEqual(parseMentionedWorkerIds("no tags here", workers), []);
    assert.deepEqual(parseMentionedWorkerIds("@Nobody", workers), []);
  });
});
