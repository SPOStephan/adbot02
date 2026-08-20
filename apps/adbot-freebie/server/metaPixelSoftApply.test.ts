import { describe, expect, it } from "vitest";
import { softApplyMetaPixel } from "../shared/metaPixelSoftApply";
import { defaultFreebieMetaTracking } from "../shared/types";

describe("freebie softApplyMetaPixel", () => {
  it("setzt leere Pixel-ID und aktiviert Tracking", () => {
    const result = softApplyMetaPixel(defaultFreebieMetaTracking, "123456789012345");
    expect(result.action).toBe("set_and_enable");
    expect(result.next).toEqual({
      enabled: true,
      pixelId: "123456789012345",
      eventName: "Lead",
    });
  });

  it("überspringt abweichende Pixel-ID", () => {
    const result = softApplyMetaPixel(
      { enabled: true, pixelId: "999999999999999", eventName: "Lead" },
      "123456789012345",
    );
    expect(result.action).toBe("skip");
  });
});
