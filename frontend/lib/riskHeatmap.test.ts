import assert from "node:assert/strict";
import test from "node:test";
import { buildFloorSpatialLinks, linkEndpoints } from "./riskHeatmap";

const MAP = {
  "11111111-1111-1111-1111-111111111111": {
    x: 352.5,
    y: 1380,
    hit: { x: 120, y: 1200, w: 465, h: 360 },
    floor: "ground" as const,
    label: "Vessel A",
  },
  "22222222-2222-2222-2222-222222222222": {
    x: 352.5,
    y: 1717.5,
    hit: { x: 120, y: 1650, w: 465, h: 135 },
    floor: "ground" as const,
    label: "Walkway 3",
  },
};

function view(
  assetId: string,
  assessment: Record<string, unknown> | null = null,
) {
  return {
    asset: { id: assetId },
    review: assessment ? { id: "r1", asset_id: assetId, state: "open" } : null,
    assessment,
  };
}

test("buildFloorSpatialLinks returns empty without assessments", () => {
  const views = [view("11111111-1111-1111-1111-111111111111")];
  const links = buildFloorSpatialLinks("ground", views as never, MAP);
  assert.equal(links.length, 0);
});

test("buildFloorSpatialLinks dedupes spatial links", () => {
  const trace = [
    {
      detail: {
        spatial_links: [
          {
            from_asset_id: "11111111-1111-1111-1111-111111111111",
            to_asset_id: "22222222-2222-2222-2222-222222222222",
            from_label: "Vessel A",
            to_label: "Walkway 3",
            relation: "NEAR",
            distance_m: 12,
            floors_apart: 0,
            reason: "Hot work near elevated gas",
          },
        ],
      },
    },
  ];
  const assessment = {
    id: "a1",
    status: "complete",
    risk_level: "blocking",
    agent_trace: trace,
  };
  const views = [view("11111111-1111-1111-1111-111111111111", assessment)];
  const links = buildFloorSpatialLinks("ground", views as never, MAP);
  assert.equal(links.length, 1);
  assert.equal(links[0].relation, "NEAR");
  assert.equal(links[0].distance_m, 12);
});

test("linkEndpoints anchors at hit-box edges facing each other", () => {
  const pts = linkEndpoints(
    {
      from_asset_id: "11111111-1111-1111-1111-111111111111",
      to_asset_id: "22222222-2222-2222-2222-222222222222",
      from_label: "Vessel A",
      to_label: "Walkway 3",
      relation: "NEAR",
      distance_m: 12,
      floors_apart: 0,
      reason: "test",
    },
    MAP,
  );
  assert.ok(pts);
  // Vessel bottom edge toward walkway (not marker center y=1380)
  assert.ok(pts.y1 > 1500);
  // Walkway top edge toward vessel (not marker center y=1717)
  assert.ok(pts.y2 < 1700);
  assert.ok(Math.abs(pts.x1 - pts.x2) < 2);
});
