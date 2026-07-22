import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  getNotificationSeenAt,
  setNotificationSeenAt,
  unreadIdsSinceSeen,
} from "./notificationSeen.ts";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      clear: () => store.clear(),
    },
  });
});

describe("notificationSeen", () => {
  it("seeds watermark on first visit and returns no unread", () => {
    const ids = unreadIdsSinceSeen(
      [
        {
          id: "a",
          created_at: "2026-07-20T10:00:00.000Z",
          recipient_ids: ["u1"],
        },
        {
          id: "b",
          created_at: "2026-07-21T10:00:00.000Z",
          recipient_ids: ["u1"],
        },
      ],
      "u1",
      () => true,
    );
    assert.deepEqual(ids, []);
    assert.equal(getNotificationSeenAt("u1"), "2026-07-21T10:00:00.000Z");
  });

  it("restores unread newer than watermark on later login", () => {
    setNotificationSeenAt("u1", "2026-07-21T10:00:00.000Z");
    const ids = unreadIdsSinceSeen(
      [
        {
          id: "a",
          created_at: "2026-07-20T10:00:00.000Z",
          recipient_ids: ["u1"],
        },
        {
          id: "b",
          created_at: "2026-07-21T10:00:00.000Z",
          recipient_ids: ["u1"],
        },
        {
          id: "c",
          created_at: "2026-07-22T08:00:00.000Z",
          recipient_ids: ["u1"],
        },
      ],
      "u1",
      () => true,
    );
    assert.deepEqual(ids, ["c"]);
  });

  it("filters by recipient", () => {
    setNotificationSeenAt("u1", "2026-07-20T00:00:00.000Z");
    const ids = unreadIdsSinceSeen(
      [
        {
          id: "mine",
          created_at: "2026-07-22T08:00:00.000Z",
          recipient_ids: ["u1"],
        },
        {
          id: "other",
          created_at: "2026-07-22T09:00:00.000Z",
          recipient_ids: ["u2"],
        },
      ],
      "u1",
      () => true,
    );
    assert.deepEqual(ids, ["mine"]);
  });
});
