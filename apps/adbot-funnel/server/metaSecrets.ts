import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "v1";

function encryptionKey(secret = process.env.JWT_SECRET) {
  if (!secret) throw new Error("JWT_SECRET fehlt; Meta-Zugangsdaten können nicht sicher gespeichert werden.");
  return createHash("sha256").update(secret).digest();
}

export function encryptMetaSecret(value: string, secret?: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), nonce);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, nonce.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptMetaSecret(value: string, secret?: string) {
  const [version, nonceValue, tagValue, encryptedValue] = value.split(".");
  if (version !== PREFIX || !nonceValue || !tagValue || !encryptedValue) throw new Error("Ungültiges Format für verschlüsselte Meta-Zugangsdaten.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(nonceValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}
