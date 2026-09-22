import { describe, expect, it, vi } from "vitest";

import { createFunnelCapiRelayToken, sendViaPortalCapi } from "./portalCapiRelay";

const SECRET = "funnel-sso-secret-for-capi-relay-tests-32";

describe("portal CAPI relay", () => {
  it("erzeugt kein Token ohne Owner oder kurzes Secret", () => {
    const previous = process.env.FUNNEL_SSO_SECRET;
    delete process.env.FUNNEL_SSO_SECRET;
    expect(
      createFunnelCapiRelayToken({
        ownerUserId: "11111111-1111-4111-8111-111111111111",
        pixelId: "123456789012345",
        eventName: "Lead",
        eventId: "evt-1",
      }),
    ).toBeNull();
    process.env.FUNNEL_SSO_SECRET = SECRET;
    expect(
      createFunnelCapiRelayToken({
        ownerUserId: "not-a-uuid",
        pixelId: "123456789012345",
        eventName: "Lead",
        eventId: "evt-1",
      }),
    ).toBeNull();
    if (previous === undefined) delete process.env.FUNNEL_SSO_SECRET;
    else process.env.FUNNEL_SSO_SECRET = previous;
  });

  it("schickt das Ereignis signiert an das Portal und kopiert kein Ads-Token", async () => {
    const previousSecret = process.env.FUNNEL_SSO_SECRET;
    const previousPortal = process.env.ADBOT_PORTAL_URL;
    process.env.FUNNEL_SSO_SECRET = SECRET;
    process.env.ADBOT_PORTAL_URL = "https://portal.test";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, eventsReceived: 1 }), { status: 200 }),
    );
    try {
      await expect(
        sendViaPortalCapi({
          ownerUserId: "11111111-1111-4111-8111-111111111111",
          pixelId: "123456789012345",
          event: {
            event_name: "Subscribe",
            event_id: "40000000-0000-4000-8000-000000000099",
          },
          testEventCode: "TEST1",
          fetchImpl: fetchMock,
        }),
      ).resolves.toEqual({ status: "sent", eventsReceived: 1, attempts: 1 });
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
      expect(fetchMock.mock.calls[0]![0]).toBe(
        "https://portal.test/api/internal/funnel-capi",
      );
      expect(body.event.event_name).toBe("Subscribe");
      expect(body.testEventCode).toBe("TEST1");
      expect(body).not.toHaveProperty("access_token");
    } finally {
      if (previousSecret === undefined) delete process.env.FUNNEL_SSO_SECRET;
      else process.env.FUNNEL_SSO_SECRET = previousSecret;
      if (previousPortal === undefined) delete process.env.ADBOT_PORTAL_URL;
      else process.env.ADBOT_PORTAL_URL = previousPortal;
    }
  });
});
