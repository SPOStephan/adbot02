const ONE_HOUR_MS = 60 * 60 * 1000;

function validDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

export function nextHourlyRun(now = new Date()): Date {
  if (!validDate(now)) {
    throw new RangeError("Invalid scheduler reference time");
  }

  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setTime(next.getTime() + ONE_HOUR_MS);
  return next;
}

export function resolveCustomerNextSyncAt(
  storedNextSyncAt: string | null | undefined,
  now = new Date(),
): string {
  if (!validDate(now)) {
    throw new RangeError("Invalid display reference time");
  }

  if (storedNextSyncAt) {
    const stored = new Date(storedNextSyncAt);

    if (validDate(stored) && stored.getTime() > now.getTime()) {
      return stored.toISOString();
    }
  }

  return nextHourlyRun(now).toISOString();
}
