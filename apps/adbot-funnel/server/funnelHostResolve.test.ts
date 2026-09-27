import { describe, expect, it } from "vitest";
import {
  accountFunnelPath,
  accountFunnelUrl,
  funnelAllowedOnHost,
  hostnameFromSourceUrl,
  preferredPublicFunnelUrl,
  resolveFunnelHostKind,
} from "../shared/funnelHostResolve";

describe("Funnel-Host-Auflösung", () => {
  it("erkennt Plattform, Funnel-Root und Account-Domain", () => {
    expect(resolveFunnelHostKind({ hostname: "funnel.adbot.one" }).kind).toBe("platform");
    expect(resolveFunnelHostKind({ hostname: "jobs.kunde.de", funnelId: "funnel-1" })).toEqual({
      kind: "funnel",
      hostname: "jobs.kunde.de",
      funnelId: "funnel-1",
    });
    expect(resolveFunnelHostKind({
      hostname: "karriere.kunde.de",
      ownerUserId: "11111111-1111-4111-8111-111111111111",
    })).toEqual({
      kind: "account",
      hostname: "karriere.kunde.de",
      ownerUserId: "11111111-1111-4111-8111-111111111111",
    });
    expect(resolveFunnelHostKind({ hostname: "fremd.example" }).kind).toBe("unknown");
  });

  it("lässt auf der Account-Domain nur Funnel desselben Kontos zu", () => {
    const host = resolveFunnelHostKind({
      hostname: "karriere.kunde.de",
      ownerUserId: "owner-a",
    });
    expect(funnelAllowedOnHost({
      host,
      funnelId: "f1",
      funnelSlug: "mechatroniker",
      ownerUserId: "owner-a",
    })).toBe(true);
    expect(funnelAllowedOnHost({
      host,
      funnelId: "f2",
      funnelSlug: "fremd",
      ownerUserId: "owner-b",
    })).toBe(false);
    expect(accountFunnelPath("mechatroniker")).toBe("/f/mechatroniker");
    expect(accountFunnelUrl("Karriere.Kunde.de", "mechatroniker")).toBe(
      "https://karriere.kunde.de/f/mechatroniker",
    );
    expect(hostnameFromSourceUrl("https://karriere.kunde.de/f/mechatroniker")).toBe("karriere.kunde.de");
  });

  it("öffnet öffentlich zuerst Funnel-Root, dann Account-Domain, dann Shared Host", () => {
    expect(preferredPublicFunnelUrl({
      slug: "vertrieb01",
      readyCustomHostname: "mechatroniker.kunde.de",
      readyAccountHostname: "jobs.kunde.de",
      fallbackOrigin: "https://funnel.adbot.one",
    })).toBe("https://mechatroniker.kunde.de/");
    expect(preferredPublicFunnelUrl({
      slug: "vertrieb01",
      readyAccountHostname: "Jobs.Boncred.info",
      fallbackOrigin: "https://funnel.adbot.one",
    })).toBe("https://jobs.boncred.info/f/vertrieb01");
    expect(preferredPublicFunnelUrl({
      slug: "vertrieb01",
      fallbackOrigin: "https://funnel.adbot.one",
    })).toBe("https://funnel.adbot.one/f/vertrieb01");
  });
});
