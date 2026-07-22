import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { citationLabel } from "./humanize";

describe("citationLabel", () => {
  it("uses snippet when incident title is generic", () => {
    assert.equal(
      citationLabel({
        source: "historical_incidents",
        title: "Historical incident",
        snippet:
          "VSP-pattern near-miss (seeded): elevated CO on coke oven battery coincided with active hot-work permit.",
      }),
      "VSP-pattern near-miss (seeded): elevated CO on coke oven battery coincided with active hot-work permit.",
    );
  });

  it("keeps regulation code and title", () => {
    assert.equal(
      citationLabel({
        source: "regulations",
        code: "OISD-STD-105",
        title: "Work Permit System (Rev. I, September 2004)",
      }),
      "OISD-STD-105: Work Permit System (Rev. I, September 2004)",
    );
  });
});
