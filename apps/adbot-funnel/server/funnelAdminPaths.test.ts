import { describe, expect, it } from "vitest";
import {
  isAllowedFunnelAdminPath,
  resolveFunnelAdminNextPath,
} from "@shared/funnelAdminPaths";

describe("funnel admin next paths", () => {
  it("erlaubt Inbox und Funnel-Routen, lehnt offene Redirects ab", () => {
    expect(isAllowedFunnelAdminPath("/admin")).toBe(true);
    expect(isAllowedFunnelAdminPath("/admin/applications")).toBe(true);
    expect(
      isAllowedFunnelAdminPath(
        "/admin/funnels/11111111-1111-4111-8111-111111111111/applications",
      ),
    ).toBe(true);
    expect(isAllowedFunnelAdminPath("https://evil.example/admin")).toBe(false);
    expect(isAllowedFunnelAdminPath("/login")).toBe(false);
    expect(resolveFunnelAdminNextPath("//evil.example", "/admin")).toBe("/admin");
    expect(
      resolveFunnelAdminNextPath("/admin/applications", "/admin"),
    ).toBe("/admin/applications");
  });
});
