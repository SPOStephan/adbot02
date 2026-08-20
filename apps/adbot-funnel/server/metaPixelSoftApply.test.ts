import { describe, expect, it } from "vitest";
import { defaultFunnel } from "@shared/defaultFunnel";
import {
  mapPortalCustomEventToFunnelEventName,
  softApplyMetaPixel,
} from "@shared/metaPixelSoftApply";

describe("softApplyMetaPixel", () => {
  const empty = defaultFunnel.metaTracking;

  it("setzt leere Pixel-ID und aktiviert Tracking", () => {
    const result = softApplyMetaPixel(empty, "123456789012345", { eventName: "Lead" });
    expect(result.action).toBe("set_and_enable");
    expect(result.next).toMatchObject({
      enabled: true,
      pixelId: "123456789012345",
      eventName: "Lead",
      conversionTrigger: "submit",
    });
  });

  it("aktiviert bei gleicher Pixel-ID", () => {
    const result = softApplyMetaPixel(
      { ...empty, pixelId: "123456789012345", enabled: false },
      "123456789012345",
    );
    expect(result.action).toBe("ensure_enabled");
    expect(result.next.enabled).toBe(true);
  });

  it("überspringt abweichende manuelle Pixel-ID", () => {
    const result = softApplyMetaPixel(
      { ...empty, pixelId: "999999999999999", enabled: true, eventName: "CompleteRegistration" },
      "123456789012345",
    );
    expect(result.action).toBe("skip");
    expect(result.next.pixelId).toBe("999999999999999");
    expect(result.next.eventName).toBe("CompleteRegistration");
  });

  it("überspringt ungültige Pixel-IDs", () => {
    expect(softApplyMetaPixel(empty, "abc").action).toBe("skip");
  });
});

describe("mapPortalCustomEventToFunnelEventName", () => {
  it("mappt LEAD auf Lead", () => {
    expect(mapPortalCustomEventToFunnelEventName("LEAD")).toBe("Lead");
    expect(mapPortalCustomEventToFunnelEventName("lead")).toBe("Lead");
  });
});
