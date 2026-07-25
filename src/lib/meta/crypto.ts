import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_KEY_BYTES = 32;

type OAuthStatePayload = {
  v: 1;
  sub: string;
  nonce: string;
  iat: number;
  exp: number;
};

export type EncryptedToken = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

export type MetaSignedRequestPayload = {
  algorithm: string;
  user_id: string;
  issued_at?: number;
  expires?: number;
  [key: string]: unknown;
};

function encodeBase64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) {
    return null;
  }

  try {
    return Buffer.from(value, "base64url");
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hmacBase64Url(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function equalBuffers(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function constantTimeEqual(left: string, right: string): boolean {
  return equalBuffers(Buffer.from(left), Buffer.from(right));
}

export function createOAuthState(
  userId: string,
  secret: string,
  now = Date.now(),
): string {
  const issuedAt = Math.floor(now / 1000);
  const payload: OAuthStatePayload = {
    v: 1,
    sub: userId,
    nonce: randomBytes(24).toString("base64url"),
    iat: issuedAt,
    exp: issuedAt + OAUTH_STATE_TTL_SECONDS,
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = hmacBase64Url(encodedPayload, secret);

  return `${encodedPayload}.${signature}`;
}

export function verifyOAuthState(
  state: string,
  secret: string,
  expectedUserId: string,
  now = Date.now(),
): OAuthStatePayload | null {
  const parts = state.split(".");

  if (parts.length !== 2) {
    return null;
  }

  const [encodedPayload, encodedSignature] = parts;
  const suppliedSignature = decodeBase64Url(encodedSignature);
  const expectedSignature = decodeBase64Url(
    hmacBase64Url(encodedPayload, secret),
  );

  if (
    !suppliedSignature ||
    !expectedSignature ||
    !equalBuffers(suppliedSignature, expectedSignature)
  ) {
    return null;
  }

  const decodedPayload = decodeBase64Url(encodedPayload);

  if (!decodedPayload) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(decodedPayload.toString("utf8"));

    if (
      !isRecord(parsed) ||
      parsed.v !== 1 ||
      parsed.sub !== expectedUserId ||
      typeof parsed.nonce !== "string" ||
      !/^[A-Za-z0-9_-]{32}$/.test(parsed.nonce) ||
      typeof parsed.iat !== "number" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }

    const currentTime = Math.floor(now / 1000);

    if (
      parsed.iat > currentTime + 30 ||
      parsed.exp < currentTime ||
      parsed.exp - parsed.iat !== OAUTH_STATE_TTL_SECONDS
    ) {
      return null;
    }

    return parsed as OAuthStatePayload;
  } catch {
    return null;
  }
}

function decodeEncryptionKey(encodedKey: string): Buffer {
  const normalized = encodedKey.trim();

  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(normalized)) {
    throw new Error(
      "META_TOKEN_ENCRYPTION_KEY muss ein Base64-kodierter 32-Byte-Schlüssel sein.",
    );
  }

  const key = Buffer.from(
    normalized.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );

  if (key.length !== AES_GCM_KEY_BYTES) {
    throw new Error(
      "META_TOKEN_ENCRYPTION_KEY muss nach Base64-Dekodierung genau 32 Byte lang sein.",
    );
  }

  return key;
}

export function encryptAccessToken(
  accessToken: string,
  encodedKey: string,
): EncryptedToken {
  if (!accessToken) {
    throw new Error("Ein leerer Meta-Zugriffstoken kann nicht verschlüsselt werden.");
  }

  const key = decodeEncryptionKey(encodedKey);
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(accessToken, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptAccessToken(
  encryptedToken: EncryptedToken,
  encodedKey: string,
): string {
  const key = decodeEncryptionKey(encodedKey);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(encryptedToken.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(encryptedToken.authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedToken.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function createAppSecretProof(
  accessToken: string,
  appSecret: string,
): string {
  return createHmac("sha256", appSecret)
    .update(accessToken)
    .digest("hex");
}

export function parseMetaSignedRequest(
  signedRequest: string,
  appSecret: string,
): MetaSignedRequestPayload | null {
  const parts = signedRequest.split(".");

  if (parts.length !== 2) {
    return null;
  }

  const [encodedSignature, encodedPayload] = parts;
  const suppliedSignature = decodeBase64Url(encodedSignature);
  const payloadBuffer = decodeBase64Url(encodedPayload);

  if (!suppliedSignature || !payloadBuffer) {
    return null;
  }

  const expectedSignature = createHmac("sha256", appSecret)
    .update(encodedPayload)
    .digest();

  if (!equalBuffers(suppliedSignature, expectedSignature)) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(payloadBuffer.toString("utf8"));

    if (
      !isRecord(parsed) ||
      typeof parsed.algorithm !== "string" ||
      parsed.algorithm.toUpperCase() !== "HMAC-SHA256" ||
      typeof parsed.user_id !== "string" ||
      !parsed.user_id
    ) {
      return null;
    }

    return parsed as MetaSignedRequestPayload;
  } catch {
    return null;
  }
}
