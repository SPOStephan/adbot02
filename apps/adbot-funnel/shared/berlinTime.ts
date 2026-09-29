/**
 * All user-facing timestamps (admin, e-mails, exports) are shown in German
 * local time (MEZ/MESZ). The server runs in UTC, so formatting without an
 * explicit time zone would be two hours off in summer.
 */
export const BERLIN_TIME_ZONE = "Europe/Berlin";

type DateInput = string | number | Date;

function format(value: DateInput, options: Intl.DateTimeFormatOptions) {
  return new Date(value).toLocaleString("de-DE", { ...options, timeZone: BERLIN_TIME_ZONE });
}

/** e.g. "29.9.2026, 11:48:36" */
export function formatBerlinDateTime(value: DateInput, options: Intl.DateTimeFormatOptions = {}) {
  return format(value, options);
}

/** e.g. "29.9.2026" */
export function formatBerlinDate(value: DateInput, options: Intl.DateTimeFormatOptions = { year: "numeric", month: "numeric", day: "numeric" }) {
  return format(value, options);
}

/** e.g. "11:48" */
export function formatBerlinTime(value: DateInput, options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" }) {
  return format(value, options);
}

/** Calendar date in Berlin as YYYY-MM-DD, e.g. for file names. */
export function berlinDateStamp(value: DateInput = new Date()) {
  return new Date(value).toLocaleDateString("sv-SE", { timeZone: BERLIN_TIME_ZONE });
}
