import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const AES_GCM_IV_BYTES = 12;
const AES_GCM_KEY_BYTES = 32;

export type EncryptedCredential = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

function decodeEncryptionKey(encodedKey: string, variableName: string): Buffer {
  const normalized = encodedKey.trim();

  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(normalized)) {
    throw new Error(
      `${variableName} muss ein Base64-kodierter 32-Byte-Schlüssel sein.`,
    );
  }

  const key = Buffer.from(
    normalized.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );

  if (key.length !== AES_GCM_KEY_BYTES) {
    throw new Error(
      `${variableName} muss nach Base64-Dekodierung genau 32 Byte lang sein.`,
    );
  }

  return key;
}

export function assertValidCredentialEncryptionKey(
  encodedKey: string,
  variableName: string,
): void {
  decodeEncryptionKey(encodedKey, variableName);
}

export function encryptCredential(
  plaintext: string,
  encodedKey: string,
  variableName: string,
): EncryptedCredential {
  if (!plaintext.trim()) {
    throw new Error("Ein leeres Credential kann nicht verschlüsselt werden.");
  }

  const key = decodeEncryptionKey(encodedKey, variableName);
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptCredential(
  encrypted: EncryptedCredential,
  encodedKey: string,
  variableName: string,
): string {
  const key = decodeEncryptionKey(encodedKey, variableName);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(encrypted.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
