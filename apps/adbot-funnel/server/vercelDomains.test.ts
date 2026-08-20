import { describe, expect, it, vi, afterEach } from "vitest";

import {
  attachDomainToVercelProject,
  getVercelDomainApiConfig,
  isVercelDomainApiConfigured,
  removeDomainFromVercelProject,
  verifyDomainOnVercelProject,
} from "./vercelDomains";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("vercelDomains config", () => {
  it("is unconfigured without token/project", () => {
    delete process.env.ADBOT_VERCEL_API_TOKEN;
    delete process.env.VERCEL_API_TOKEN;
    delete process.env.VERCEL_PROJECT_ID;
    expect(isVercelDomainApiConfigured()).toBe(false);
    expect(getVercelDomainApiConfig()).toBeNull();
  });

  it("reads ADBOT_VERCEL_API_TOKEN and VERCEL_PROJECT_ID", () => {
    process.env.ADBOT_VERCEL_API_TOKEN = "x".repeat(40);
    process.env.VERCEL_PROJECT_ID = "prj_test";
    process.env.VERCEL_TEAM_ID = "team_test";
    expect(isVercelDomainApiConfigured()).toBe(true);
    expect(getVercelDomainApiConfig()).toEqual({
      token: "x".repeat(40),
      projectId: "prj_test",
      teamId: "team_test",
    });
  });
});

describe("vercelDomains API", () => {
  it("attach treats already-exists as success", async () => {
    process.env.ADBOT_VERCEL_API_TOKEN = "x".repeat(40);
    process.env.VERCEL_PROJECT_ID = "prj_test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 409,
        json: async () => ({ error: { message: "Domain already exists" } }),
      })),
    );
    const result = await attachDomainToVercelProject("leads.example.de");
    expect(result.ok).toBe(true);
    expect(result.alreadyAttached).toBe(true);
  });

  it("attach returns ok on 200", async () => {
    process.env.ADBOT_VERCEL_API_TOKEN = "x".repeat(40);
    process.env.VERCEL_PROJECT_ID = "prj_test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 200,
        json: async () => ({ name: "leads.example.de", verified: true }),
      })),
    );
    const result = await attachDomainToVercelProject("leads.example.de");
    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
  });

  it("verify posts to verify endpoint", async () => {
    process.env.ADBOT_VERCEL_API_TOKEN = "x".repeat(40);
    process.env.VERCEL_PROJECT_ID = "prj_test";
    const fetchMock = vi.fn(async () => ({
      status: 200,
      json: async () => ({ verified: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await verifyDomainOnVercelProject("leads.example.de");
    expect(result.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/domains/leads.example.de/verify",
    );
  });

  it("remove treats 404 as success", async () => {
    process.env.ADBOT_VERCEL_API_TOKEN = "x".repeat(40);
    process.env.VERCEL_PROJECT_ID = "prj_test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 404,
        json: async () => ({ error: { message: "not found" } }),
      })),
    );
    const result = await removeDomainFromVercelProject("leads.example.de");
    expect(result.ok).toBe(true);
  });
});
