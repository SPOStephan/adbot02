import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { ENV } from "./env";
import { getMemberByEmail, type FunnelMember } from "../funnelMembers";

/**
 * Funnel-only-Logins (Tabelle `funnel_admin_members`). Ein Mitglied sieht und bearbeitet
 * genau die Funnel des Adbot-Kontos `ownerUserId`, so als wäre es per Adbot-SSO angemeldet,
 * hat aber keinen Adbot-Zugang. Angelegt wird es im Funnel-Admin unter „Konto“.
 */
const SCRYPT_KEYLEN = 64;
export const MEMBER_PASSWORD_MIN_LENGTH = 12;

export function hashMemberPassword(password: string, salt: Buffer = randomBytes(16)): string {
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

/** Die Plattform-Admin-Adresse darf nie als Mitglied gelten. */
export function isReservedMemberEmail(email: string) {
  return Boolean(ENV.adminEmail) && email.trim().toLowerCase() === ENV.adminEmail;
}

export async function findMemberLogin(email: string): Promise<FunnelMember | null> {
  if (isReservedMemberEmail(email)) return null;
  return getMemberByEmail(email);
}

export async function verifyMemberPassword(email: string, password: string): Promise<FunnelMember | null> {
  const member = await findMemberLogin(email).catch(error => {
    console.error("[member-login] Zugang nicht lesbar", error);
    return null;
  });
  if (!member) return null;
  return verifyMemberPasswordHash(password, member.passwordHash) ? member : null;
}

/** Kurzer Fingerabdruck des Passwort-Hashes: ein neues Passwort beendet alte Sitzungen. */
export function memberCredentialVersion(member: Pick<FunnelMember, "passwordHash">): string {
  return createHash("sha256").update(member.passwordHash, "utf8").digest("base64url").slice(0, 16);
}
