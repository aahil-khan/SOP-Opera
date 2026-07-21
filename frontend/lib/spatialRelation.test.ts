import assert from "node:assert/strict";
import test from "node:test";
import {
  otherAssetIdInLink,
  relationRelativeToFocus,
} from "./spatialRelation";

test("relationRelativeToFocus resolves BELOW from upper floor", () => {
  assert.equal(relationRelativeToFocus("ABOVE", "first", "ground"), "BELOW");
  assert.equal(relationRelativeToFocus("ABOVE", "ground", "first"), "ABOVE");
  assert.equal(relationRelativeToFocus("NEAR", "ground", "ground"), "NEAR");
});

test("otherAssetIdInLink picks the counterpart asset", () => {
  const link = {
    from_asset_id: "a",
    to_asset_id: "b",
    from_label: "A",
    to_label: "B",
  };
  assert.equal(otherAssetIdInLink("a", link), "b");
  assert.equal(otherAssetIdInLink("b", link), "a");
});
