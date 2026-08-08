import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";
import {
  buildAdminUser,
  createSessionToken,
  verifyAdminPassword,
  verifySessionToken,
} from "./_core/session";

process.env.JWT_SECRET = "test-secret-at-least-32-characters-long";
process.env.ADMIN_EMAIL = "admin@example.com";
process.env.ADMIN_PASSWORD = "test-password";

describe("auth.login without Manus", () => {
  it("akzeptiert nur die konfigurierten Admin-Zugangsdaten", () => {
    expect(verifyAdminPassword("admin@example.com", "test-password")).toBe(true);
    expect(verifyAdminPassword("other@example.com", "test-password")).toBe(false);
    expect(verifyAdminPassword("admin@example.com", "wrong")).toBe(false);
  });

  it("stellt eine JWT-Session ohne Manus-OAuth aus", async () => {
    const cookies: Array<{ name: string; value: string }> = [];
    const ctx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {
        cookie: (name: string, value: string) => {
          cookies.push({ name, value });
        },
      } as TrpcContext["res"],
    };

    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.login({
      email: "admin@example.com",
      password: "test-password",
    });

    expect(result.success).toBe(true);
    expect(result.user.role).toBe("admin");
    expect(result.user.loginMethod).toBe("password");
    expect(cookies).toHaveLength(1);
    expect(cookies[0]?.name).toBe(COOKIE_NAME);

    const claims = await verifySessionToken(cookies[0]?.value);
    expect(claims?.email).toBe("admin@example.com");
    expect(claims?.role).toBe("admin");

    const token = await createSessionToken(buildAdminUser());
    expect(await verifySessionToken(token)).toMatchObject({
      email: "admin@example.com",
      role: "admin",
    });
  });
});
