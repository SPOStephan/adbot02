function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export const KIREADY_CONTEXT_ERROR_CODES = [
  "AUTH_REQUIRED",
  "CLIENT_NOT_ALLOWED",
  "ORGANIZATION_NOT_FOUND",
  "ADBOT_ENTITLEMENT_REQUIRED",
  "ADBOT_ACCESS_NOT_ASSIGNED",
] as const;

export type KireadyContextErrorCode =
  | (typeof KIREADY_CONTEXT_ERROR_CODES)[number]
  | "CONTEXT_UNAVAILABLE";

export class KireadyContextError extends Error {
  readonly code: KireadyContextErrorCode;
  readonly status: number;

  constructor(code: KireadyContextErrorCode, status: number, message: string) {
    super(message);
    this.name = "KireadyContextError";
    this.code = code;
    this.status = status;
  }
}

export function kireadyContextErrorMessage(code: KireadyContextErrorCode): string {
  switch (code) {
    case "AUTH_REQUIRED":
      return "KIready-Anmeldung abgelaufen. Bitte erneut mit KIready anmelden.";
    case "CLIENT_NOT_ALLOWED":
      return "Dieser Adbot-Client ist bei KIready nicht zugelassen.";
    case "ORGANIZATION_NOT_FOUND":
      return "Kein KIready-Unternehmensbereich gefunden.";
    case "ADBOT_ENTITLEMENT_REQUIRED":
      return "Für dieses Unternehmen ist Adbot derzeit nicht freigeschaltet.";
    case "ADBOT_ACCESS_NOT_ASSIGNED":
      return "Dein Unternehmen hat Adbot, aber du bist persönlich nicht freigeschaltet.";
    default:
      return "KIready-Adbot-Kontext nicht erreichbar.";
  }
}

export function readKireadyContextErrorCode(
  status: number,
  raw: unknown,
): KireadyContextErrorCode {
  const candidates = isRecord(raw)
    ? [raw.code, raw.error, raw.error_code, raw.errorCode]
    : [];
  for (const candidate of candidates) {
    const value = text(candidate).toUpperCase();
    if ((KIREADY_CONTEXT_ERROR_CODES as readonly string[]).includes(value)) {
      return value as (typeof KIREADY_CONTEXT_ERROR_CODES)[number];
    }
  }
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 402) return "ADBOT_ENTITLEMENT_REQUIRED";
  if (status === 404) return "ORGANIZATION_NOT_FOUND";
  if (status === 403) return "CLIENT_NOT_ALLOWED";
  return "CONTEXT_UNAVAILABLE";
}

export function resolveKireadyContextError(
  status: number,
  raw: unknown,
): KireadyContextError {
  const code = readKireadyContextErrorCode(status, raw);
  return new KireadyContextError(code, status, kireadyContextErrorMessage(code));
}
