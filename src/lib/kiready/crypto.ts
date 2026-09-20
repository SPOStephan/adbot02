import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const AES_GCM_IV_BYTES = 12;
const AES_GCM_KEY_BYTES = 32;

export type EncryptedBlob = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

function decodeEncryptionKey(encodedKey: string): Buffer {
  const normalized = encodedKey.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(normalized)) {
    throw new Error(
      "KIREADY_TOKEN_ENCRYPTION_KEY muss ein Base64-kodierter 32-Byte-Schlüssel sein.",
    );
  }
  const key = Buffer.from(
    normalized.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );
  if (key.length !== AES_GCM_KEY_BYTES) {
    throw new Error(
      "KIREADY_TOKEN_ENCRYPTION_KEY muss nach Base64-Dekodierung genau 32 Byte lang sein.",
    );
  }
  return key;
}

export function signKireadyPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function verifyKireadySignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expected = Buffer.from(signKireadyPayload(payload, secret));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function encryptKireadySecret(
  value: string,
  encodedKey: string,
): EncryptedBlob {
  const key = decodeEncryptionKey(encodedKey);
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptKireadySecret(
  blob: EncryptedBlob,
  encodedKey: string,
): string {
  const key = decodeEncryptionKey(encodedKey);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(blob.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(blob.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function randomOidcValue(): string {
  return randomBytes(24).toString("base64url");
}
