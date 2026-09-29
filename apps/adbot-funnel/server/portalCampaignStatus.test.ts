import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPortalCampaignStatusToken,
  loadPortalCampaignOverview,
  loadPortalCampaignStatuses,
} from "./portalCampaignStatus";

const SECRET = "funnel-sso-secret-for-campaign-status-tests";
const OWNER = "11111111-1111-4111-8111-111111111111";
const FUNNEL_URL = "https://jobs.example.org/f/vertrieb";

const previousSecret = process.env.FUNNEL_SSO_SECRET;
const previousPortal = process.env.ADBOT_PORTAL_URL;

afterEach(() => {
  if (previousSecret === undefined) delete process.env.FUNNEL_SSO_SECRET;
  else process.env.FUNNEL_SSO_SECRET = previousSecret;
  if (previousPortal === undefined) delete process.env.ADBOT_PORTAL_URL;
  else process.env.ADBOT_PORTAL_URL = previousPortal;
});

describe("portal campaign status", () => {
  it("erzeugt nur für eine gültige Owner-ID ein kurzlebiges Token", () => {
    process.env.FUNNEL_SSO_SECRET = SECRET;
    expect(createPortalCampaignStatusToken({ ownerUserId: "invalid" })).toBeNull();
    expect(createPortalCampaignStatusToken({ ownerUserId: OWNER, now: 1_000 })).toMatch(
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
  });

  it("liest Lead- und Traffic-Status signiert ohne Meta-Zugangsdaten", async () => {
    process.env.FUNNEL_SSO_SECRET = SECRET;
    process.env.ADBOT_PORTAL_URL = "https://portal.test";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          statuses: {
            [FUNNEL_URL]: {
              leadActive: true,
              leadSubmitted: true,
              trafficActive: false,
              trafficSubmitted: false,
              updatedAt: "2026-09-28T12:00:00.000Z",
            },
          },
        }),
        { status: 200 },
      ),
    );

    await expect(
      loadPortalCampaignStatuses({
        ownerUserId: OWNER,
        destinationUrls: [FUNNEL_URL],
        fetchImpl: fetchMock,
      }),
    ).resolves.toEqual({
      [FUNNEL_URL]: {
        leadActive: true,
        leadSubmitted: true,
        trafficActive: false,
        trafficSubmitted: false,
        updatedAt: "2026-09-28T12:00:00.000Z",
      },
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://portal.test/api/internal/funnel-campaign-status",
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(body.destinationUrls).toEqual([FUNNEL_URL]);
    expect(body.token).toEqual(expect.any(String));
    expect(body).not.toHaveProperty("accessToken");
    expect(body).not.toHaveProperty("metaToken");
  });

  it("lädt die Kampagnen-Übersicht mit eigenem Token-Zweck und nur Funnel-Typen", async () => {
    process.env.FUNNEL_SSO_SECRET = SECRET;
    process.env.ADBOT_PORTAL_URL = "https://portal.test";
    const campaign = (id: string, kind: string) => ({
      id,
      displayName: id,
      kind,
      lifecycle: "active",
      statusLabel: "Aktiv",
      funnelUrl: FUNNEL_URL,
      destinationUrl: FUNNEL_URL,
      variantDestinationUrl: null,
      dailyBudgetMinor: 1000,
      lifetimeBudgetMinor: null,
      startTime: null,
      stopTime: null,
      spend: 5,
      impressions: 100,
      linkClicks: 4,
      leads: 1,
      currency: "EUR",
      previewMode: "single",
      cards: [],
      totalCombinationCount: 0,
      isTruncated: false,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          advertiserName: "Muster GmbH",
          campaigns: [campaign("lead-1", "lead"), campaign("boost-1", "boost")],
        }),
        { status: 200 },
      ),
    );

    const result = await loadPortalCampaignOverview({
      ownerUserId: OWNER,
      funnelUrls: [FUNNEL_URL, FUNNEL_URL],
      fetchImpl: fetchMock,
    });
    expect(result.available).toBe(true);
    expect(result.advertiserName).toBe("Muster GmbH");
    expect(result.campaigns.map(item => item.id)).toEqual(["lead-1"]);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://portal.test/api/internal/funnel-campaign-overview",
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(body.funnelUrls).toEqual([FUNNEL_URL]);
    const [encoded] = String(body.token).split(".");
    const payload = JSON.parse(Buffer.from(encoded!, "base64url").toString("utf8"));
    expect(payload.purpose).toBe("funnel_campaign_overview");
    expect(payload.sub).toBe(OWNER);
  });

  it("meldet einen Portal-Fehler als nicht verfügbar statt leer", async () => {
    process.env.FUNNEL_SSO_SECRET = SECRET;
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 500 }));
    await expect(
      loadPortalCampaignOverview({ ownerUserId: OWNER, funnelUrls: [FUNNEL_URL], fetchImpl: fetchMock }),
    ).resolves.toEqual({ available: false, advertiserName: null, campaigns: [] });
  });
});
