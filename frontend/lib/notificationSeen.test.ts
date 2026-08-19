import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  getNotificationSeenAt,
  setNotificationSeenAt,
  unreadIdsSinceSeen,
} from "./notificationSeen";

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
  const hoursAgo = (h: number) =>
    new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

  it("seeds watermark to the shift boundary on first visit", () => {
    const ids = unreadIdsSinceSeen(
      [
        { id: "old", created_at: hoursAgo(30), recipient_ids: ["u1"] },
        { id: "recent", created_at: hoursAgo(2), recipient_ids: ["u1"] },
      ],
      "u1",
      () => true,
    );
    // Within the 12h shift window counts as unread; older is history.
    assert.deepEqual(ids, ["recent"]);
    const seeded = getNotificationSeenAt("u1");
    assert.ok(seeded != null);
    const ageH = (Date.now() - Date.parse(seeded)) / 3_600_000;
    assert.ok(ageH > 11.9 && ageH < 12.1, `seeded ${ageH}h ago`);
  });

  it("returns no unread on first visit when everything predates the shift", () => {
    const ids = unreadIdsSinceSeen(
      [
        { id: "a", created_at: hoursAgo(48), recipient_ids: ["u1"] },
        { id: "b", created_at: hoursAgo(13), recipient_ids: ["u1"] },
      ],
      "u1",
      () => true,
    );
    assert.deepEqual(ids, []);
  });

  it("compares API +00:00 timestamps against a Z watermark by instant", () => {
    // The API emits microsecond `+00:00`; toISOString emits millisecond `Z`.
    // Lexically "…47.385088+00:00" < "…47.385Z", which would misread it.
    setNotificationSeenAt("u1", "2026-08-19T09:31:47.385Z");
    const ids = unreadIdsSinceSeen(
      [
        {
          id: "later",
          created_at: "2026-08-19T09:46:16.844166+00:00",
          recipient_ids: ["u1"],
        },
        {
          id: "earlier",
          created_at: "2026-08-19T09:00:00.000000+00:00",
          recipient_ids: ["u1"],
        },
      ],
      "u1",
      () => true,
    );
    assert.deepEqual(ids, ["later"]);
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
