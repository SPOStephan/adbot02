import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyAdbotSsoToken } from "./adbotSso";

const SECRET = "test-funnel-sso-secret-at-least-32-chars!!";

function mintToken(overrides: Record<string, unknown> = {}) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    purpose: "funnel_admin_sso",
    sub: "11111111-2222-4333-8444-555555555555",
    email: "kunde@example.org",
    name: "Kunde",
    nonce: randomBytes(24).toString("base64url"),
    iat: issuedAt,
    exp: issuedAt + 300,
    ...overrides,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", SECRET).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

describe("verifyAdbotSsoToken", () => {
  it("akzeptiert gültige Tokens und lehnt Replay ab", () => {
    const token = mintToken();
    const first = verifyAdbotSsoToken(token, SECRET);
    expect(first?.email).toBe("kunde@example.org");
    expect(first?.sub).toBe("11111111-2222-4333-8444-555555555555");
    expect(verifyAdbotSsoToken(token, SECRET)).toBeNull();
  });

  it("lehnt abgelaufene und manipulierte Tokens ab", () => {
    const expired = mintToken({
      iat: Math.floor(Date.now() / 1000) - 1000,
      exp: Math.floor(Date.now() / 1000) - 10,
      nonce: randomBytes(24).toString("base64url"),
    });
    expect(verifyAdbotSsoToken(expired, SECRET)).toBeNull();

    const [payload] = mintToken().split(".");
    expect(verifyAdbotSsoToken(`${payload}.deadbeef`, SECRET)).toBeNull();
  });
});
