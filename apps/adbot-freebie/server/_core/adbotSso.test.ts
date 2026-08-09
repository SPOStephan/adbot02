import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyAdbotSsoToken } from "./adbotSso";

const SECRET = "x".repeat(48);

function signPayload(payload: Record<string, unknown>) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", SECRET)
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

describe("verifyAdbotSsoToken", () => {
  it("accepts a valid freebie SSO token", () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signPayload({
      v: 1,
      purpose: "freebie_admin_sso",
      sub: "11111111-1111-4111-8111-111111111111",
      email: "kunde@example.com",
      name: "Kunde",
      nonce: randomBytes(16).toString("base64url"),
      iat: now,
      exp: now + 300,
    });

    const payload = verifyAdbotSsoToken(token, SECRET);
    expect(payload?.email).toBe("kunde@example.com");
    expect(payload?.purpose).toBe("freebie_admin_sso");
  });

  it("rejects funnel purpose tokens", () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signPayload({
      v: 1,
      purpose: "funnel_admin_sso",
      sub: "11111111-1111-4111-8111-111111111111",
      email: "kunde@example.com",
      name: "Kunde",
      nonce: randomBytes(16).toString("base64url"),
      iat: now,
      exp: now + 300,
    });

    expect(verifyAdbotSsoToken(token, SECRET)).toBeNull();
  });
});
