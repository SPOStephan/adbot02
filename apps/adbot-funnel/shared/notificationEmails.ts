/**
 * Funnel notification recipients are stored in the single
 * `notification_email` text column as a comma-separated list, so existing
 * single-address funnels keep working without a migration.
 */
export const MAX_NOTIFICATION_EMAILS = 10;

const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export function parseNotificationEmails(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(/[,;\s]+/)
    .map(entry => entry.trim())
    .filter(Boolean);
}

export function formatNotificationEmails(emails: readonly string[]): string {
  return emails.map(entry => entry.trim()).filter(Boolean).join(", ");
}

export function isValidNotificationEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

export function notificationEmailsAreValid(value: string): boolean {
  const emails = parseNotificationEmails(value);
  return emails.length <= MAX_NOTIFICATION_EMAILS && emails.every(isValidNotificationEmail);
}
