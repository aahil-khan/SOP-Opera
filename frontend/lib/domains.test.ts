import assert from "node:assert/strict";
import test from "node:test";
import { computeAllDomainScores, type DomainId } from "./domains";

type TestView = Parameters<typeof computeAllDomainScores>[0];
type Score = ReturnType<typeof computeAllDomainScores>[number];

/** An asset mid-incident: hot work permit, crew in the zone, facts and refs. */
function busyView(): TestView {
  return {
    asset: {
      id: "a1",
      name: "Coke Oven 3",
      zone: "coke-oven-battery",
      plant_id: "p",
      floor: "ground",
    },
    review: {
      id: "r1",
      asset_id: "a1",
      state: "closed",
      owner_id: "u1",
      triggered_by: "test",
      origin: "system",
      raised_by_worker_id: null,
      created_at: "2026-01-01T00:00:00Z",
    },
    detail: {
      review: {} as never,
      asset: {} as never,
      context: [
        {
          id: "c1",
          asset_id: "a1",
          category: "permit",
          payload: { status: "active", work_type: "hot_work" },
          recorded_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "c2",
          asset_id: "a1",
          category: "worker_location",
          payload: { zone: "hazardous" },
          recorded_at: "2026-01-01T00:00:00Z",
        },
      ],
      derived_facts: [{ id: "f1", fact_type: "elevated_gas", value: true }],
      decision: null,
      task_summary: null,
    } as unknown as TestView["detail"],
    assessment: {
      id: "as1",
      review_id: "r1",
      risk_level: "blocking",
      summary: "",
      recommendations: [],
      evidence_refs: [],
      retrieved_references: [
        { source: "regulations", title: "OISD 105", snippet: "", clause: "5.2" },
      ],
      model_meta: {},
      created_at: "2026-01-01T00:00:00Z",
    } as unknown as TestView["assessment"],
    risk_level: "blocking",
    sensor_critical: false,
    map_cleared: false,
  };
}

const LIVE_EXTRAS = {
  metricCount: 2,
  elevatedMetricCount: 1,
  gasPpm: 34,
  neighborCount: 3,
  historyCount: 4,
  responseLiveCount: 2,
  responseProtectCount: 1,
  responseRefusedCount: 1,
};

const REVIEW_DERIVED: DomainId[] = ["permits", "people", "evidence", "response"];
const ASSET_SCOPED: DomainId[] = ["sensors", "spatial", "history"];

function byId(scores: Score[]): Record<DomainId, Score> {
  return Object.fromEntries(scores.map((s) => [s.domain, s])) as Record<
    DomainId,
    Score
  >;
}

test("review-derived faces read live while the review is open", () => {
  const s = byId(computeAllDomainScores(busyView(), LIVE_EXTRAS));
  for (const id of REVIEW_DERIVED) {
    assert.equal(s[id].empty, false, `${id} should be live`);
  }
});

test("reviewResolved resets every review-derived face", () => {
  const s = byId(
    computeAllDomainScores(busyView(), { ...LIVE_EXTRAS, reviewResolved: true }),
  );

  for (const id of REVIEW_DERIVED) {
    assert.equal(s[id].empty, true, `${id} should be empty on all clear`);
    assert.equal(s[id].score, 0, `${id} should score 0 on all clear`);
    assert.equal(s[id].warn, false, `${id} must not warn on all clear`);
  }

  assert.equal(s.response.headline, "Nothing automatic yet");
  assert.equal(s.evidence.headline, "No evidence yet");
  assert.equal(s.permits.headline, "No active permits");
});

test("asset-scoped faces are untouched by reviewResolved", () => {
  const live = byId(computeAllDomainScores(busyView(), LIVE_EXTRAS));
  const clear = byId(
    computeAllDomainScores(busyView(), { ...LIVE_EXTRAS, reviewResolved: true }),
  );

  for (const id of ASSET_SCOPED) {
    assert.equal(clear[id].empty, live[id].empty, `${id} emptiness changed`);
    assert.equal(clear[id].score, live[id].score, `${id} score changed`);
  }
  // The closed record still has somewhere to live.
  assert.equal(clear.history.headline, "4 prior closures");
});

test("all clear keeps the zone owner, drops the review's crew", () => {
  const s = byId(
    computeAllDomainScores(busyView(), {
      ...LIVE_EXTRAS,
      areaOwner: { id: "o1", name: "R. Menon" } as never,
      reviewResolved: true,
    }),
  );
  assert.equal(s.people.empty, false);
  assert.equal(s.people.headline, "Owner · R. Menon");
  assert.equal(s.people.warn, false);
});
