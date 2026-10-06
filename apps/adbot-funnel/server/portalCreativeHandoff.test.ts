import { describe, expect, it } from "vitest";

import { shouldPushPublishedFunnel } from "./portalCreativeHandoff";

const base = { status: "published", slug: "immo02", purpose: "lead_qualification" } as const;

describe("shouldPushPublishedFunnel", () => {
  it("meldet einen Funnel, der im Editor erstmals veröffentlicht wird", () => {
    expect(shouldPushPublishedFunnel({ ...base, status: "draft" }, base)).toBe(true);
  });

  it("meldet eine neue öffentliche URL nach Slug-Änderung", () => {
    expect(shouldPushPublishedFunnel(base, { ...base, slug: "immo02-berlin" })).toBe(true);
  });

  it("bleibt bei unverändertem veröffentlichtem Funnel still", () => {
    expect(shouldPushPublishedFunnel(base, base)).toBe(false);
  });

  it("meldet keine Entwürfe oder pausierten Funnels", () => {
    expect(shouldPushPublishedFunnel({ ...base, status: "draft" }, { ...base, status: "draft" })).toBe(false);
    expect(shouldPushPublishedFunnel(base, { ...base, status: "paused" })).toBe(false);
  });
});
