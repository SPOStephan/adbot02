import { createHash, scryptSync, timingSafeEqual } from "node:crypto";
import { ENV } from "./env";

/**
 * Zusätzliche Logins nur für den Funnel-Admin (z. B. für das Kundenunternehmen).
 * Ein Mitglied sieht und bearbeitet genau die Funnel des Adbot-Kontos `ownerUserId`,
 * so als wäre es per Adbot-SSO angemeldet, hat aber keinen Adbot-Zugang.
 *
 * Konfiguration über `FUNNEL_MEMBER_LOGINS` (JSON-Array), Passwort nur als Hash:
 *   [{"email":"kunde@firma.de","name":"Firma GmbH","ownerUserId":"<Adbot-User-UUID>",
 *     "passwordHash":"scrypt$<salt>$<hash>"}]
 * Hash erzeugen: `node scripts/hash-member-password.mjs`.
 */
export type MemberLogin = {
  email: string;
  name: string;
  ownerUserId: string;
  passwordHash: string;
};

const SCRYPT_KEYLEN = 64;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseEntry(raw: unknown): MemberLogin | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const email = typeof entry.email === "string" ? entry.email.trim().toLowerCase() : "";
  const ownerUserId = typeof entry.ownerUserId === "string" ? entry.ownerUserId.trim() : "";
  const passwordHash = typeof entry.passwordHash === "string" ? entry.passwordHash.trim() : "";
  if (!email.includes("@") || !UUID_RE.test(ownerUserId) || !passwordHash.startsWith("scrypt$")) {
    return null;
  }
  // Die Plattform-Admin-Adresse darf nie zu einem Mitglied werden.
  if (ENV.adminEmail && email === ENV.adminEmail) return null;
  const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : email;
  return { email, name, ownerUserId, passwordHash };
}

export function listMemberLogins(): MemberLogin[] {
  const raw = ENV.memberLogins.trim();
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseEntry).filter((item): item is MemberLogin => item !== null);
  } catch {
    console.error("[member-login] FUNNEL_MEMBER_LOGINS ist kein gültiges JSON");
    return [];
  }
}

export function findMemberLogin(email: string): MemberLogin | null {
  const normalized = email.trim().toLowerCase();
  return listMemberLogins().find(item => item.email === normalized) ?? null;
}

export function hashMemberPassword(password: string, salt: Buffer): string {
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyMemberPasswordHash(password: string, passwordHash: string): boolean {
  const [scheme, saltPart, hashPart] = passwordHash.split("$");
  if (scheme !== "scrypt" || !saltPart || !hashPart) return false;
  const expected = Buffer.from(hashPart, "base64url");
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const actual = scryptSync(password, Buffer.from(saltPart, "base64url"), SCRYPT_KEYLEN);
  return timingSafeEqual(actual, expected);
}

export function verifyMemberPassword(email: string, password: string): MemberLogin | null {
  const member = findMemberLogin(email);
  if (!member) return null;
  return verifyMemberPasswordHash(password, member.passwordHash) ? member : null;
}

/** Kurzer Fingerabdruck des Passwort-Hashes: ein neues Passwort beendet alte Sitzungen. */
export function memberCredentialVersion(member: MemberLogin): string {
  return createHash("sha256").update(member.passwordHash, "utf8").digest("base64url").slice(0, 16);
}
