import assert from "node:assert/strict";

import {
  MAX_META_AD_PREVIEW_COMBINATIONS,
  buildMetaAdPreviewCombinations,
} from "../src/lib/meta/ad-preview-combinations.ts";

const complete = buildMetaAdPreviewCombinations({
  assetIds: ["asset-a", "asset-a", "asset-b"],
  primaryTexts: ["Text A", "Text A", "Text B"],
  headlines: ["Headline A", "Headline B"],
  descriptions: ["Beschreibung A", "Beschreibung B"],
});

assert.equal(complete.totalCombinationCount, 8);
assert.equal(complete.combinations.length, 8);
assert.equal(complete.isTruncated, false);
assert.equal(
  new Set(
    complete.combinations.map(
      (item) => `${item.assetId}:${item.primaryText}:${item.headline}`,
    ),
  ).size,
  8,
);

const largeInput = {
  assetIds: Array.from({ length: 10 }, (_, index) => `asset-${index + 1}`),
  primaryTexts: Array.from({ length: 5 }, (_, index) => `Text ${index + 1}`),
  headlines: Array.from({ length: 5 }, (_, index) => `Headline ${index + 1}`),
  descriptions: ["Kurzbeschreibung"],
};
const representative = buildMetaAdPreviewCombinations(largeInput);
const repeated = buildMetaAdPreviewCombinations(largeInput);

assert.equal(representative.totalCombinationCount, 250);
assert.equal(representative.combinations.length, MAX_META_AD_PREVIEW_COMBINATIONS);
assert.equal(representative.isTruncated, true);
assert.deepEqual(representative, repeated);
assert.equal(
  new Set(representative.combinations.map((item) => item.assetId)).size,
  10,
);
assert.equal(
  new Set(representative.combinations.map((item) => item.primaryText)).size,
  5,
);
assert.equal(
  new Set(representative.combinations.map((item) => item.headline)).size,
  5,
);
assert.equal(
  new Set(
    representative.combinations.map(
      (item) => `${item.assetId}:${item.primaryText}:${item.headline}`,
    ),
  ).size,
  MAX_META_AD_PREVIEW_COMBINATIONS,
);

const fallback = buildMetaAdPreviewCombinations({
  assetIds: ["asset-a"],
  primaryTexts: ["  "],
  headlines: [],
  defaultPrimaryText: "Jetzt bewerben.",
  defaultHeadline: "Stelle ansehen",
});
assert.deepEqual(fallback.combinations, [
  {
    assetId: "asset-a",
    primaryText: "Jetzt bewerben.",
    headline: "Stelle ansehen",
    description: "",
  },
]);

console.log("meta-ad-preview-combinations: ok");
