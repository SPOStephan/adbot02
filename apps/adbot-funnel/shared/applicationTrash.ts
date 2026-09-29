/** Days a deleted entry stays restorable in the trash before it is removed for good. */
export const APPLICATION_TRASH_RETENTION_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The moment a trashed entry becomes eligible for permanent removal. */
export function applicationPurgeAt(deletedAt: string): Date {
  return new Date(new Date(deletedAt).getTime() + APPLICATION_TRASH_RETENTION_DAYS * DAY_MS);
}

/** Entries deleted before this cutoff are due for permanent removal. */
export function applicationPurgeCutoff(now: Date = new Date()): string {
  return new Date(now.getTime() - APPLICATION_TRASH_RETENTION_DAYS * DAY_MS).toISOString();
}
