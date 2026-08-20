import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { defaultFunnel } from "@shared/defaultFunnel";
import { softApplyPixelToOwnerFunnels } from "./_core/portalMetaSyncRoute";
import {
  createFunnel,
  getFunnelById,
  resetMemoryStoreForTests,
} from "./funnelStore";

const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe("portal meta pixel soft-apply", () => {
  beforeAll(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  beforeEach(() => resetMemoryStoreForTests());

  afterAll(() => {
    if (originalUrl) process.env.SUPABASE_URL = originalUrl;
    if (originalKey) process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    resetMemoryStoreForTests();
  });

  it("übernimmt Pixel in leere Owner-Funnels und lässt abweichende unangetastet", async () => {
    const owner = {
      userId: "11111111-1111-4111-8111-111111111111",
      email: "owner@example.org",
    };
    const empty = await createFunnel(
      {
        ...structuredClone(defaultFunnel),
        id: randomUUID(),
        slug: "empty-pixel",
        title: "Empty",
      },
      owner,
    );
    const manual = await createFunnel(
      {
        ...structuredClone(defaultFunnel),
        id: randomUUID(),
        slug: "manual-pixel",
        title: "Manual",
        metaTracking: {
          ...defaultFunnel.metaTracking,
          enabled: true,
          pixelId: "999999999999999",
          eventName: "CompleteRegistration",
        },
      },
      owner,
    );

    const results = await softApplyPixelToOwnerFunnels({
      ownerUserId: owner.userId,
      pixelId: "123456789012345",
      eventName: "Lead",
    });

    expect(results.find(item => item.funnelId === empty.id)?.action).toBe(
      "set_and_enable",
    );
    expect(results.find(item => item.funnelId === manual.id)?.action).toBe("skip");

    const updatedEmpty = await getFunnelById(empty.id);
    const updatedManual = await getFunnelById(manual.id);
    expect(updatedEmpty?.metaTracking).toMatchObject({
      enabled: true,
      pixelId: "123456789012345",
      eventName: "Lead",
    });
    expect(updatedManual?.metaTracking.pixelId).toBe("999999999999999");
  });
});
