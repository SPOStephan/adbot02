import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPortalCampaignStatusToken,
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
              trafficActive: false,
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
        trafficActive: false,
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
});
