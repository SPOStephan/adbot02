import { describe, expect, it } from "vitest";
import { decryptMetaSecret, encryptMetaSecret } from "./metaSecrets";

describe("Verschlüsselte Meta-Zugangsdaten", () => {
  it("speichert weder Klartext noch deterministische Chiffren und entschlüsselt nur mit demselben Schlüssel", () => {
    const first = encryptMetaSecret("EAAB-secret-token", "test-key");
    const second = encryptMetaSecret("EAAB-secret-token", "test-key");
    expect(first).not.toContain("EAAB-secret-token");
    expect(first).not.toBe(second);
    expect(decryptMetaSecret(first, "test-key")).toBe("EAAB-secret-token");
    expect(() => decryptMetaSecret(first, "wrong-key")).toThrow();
  });
});
