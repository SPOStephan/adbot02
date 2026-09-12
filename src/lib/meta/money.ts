export function parseMetaCurrencyMinor(value: string | null): number | null {
  const match = value?.match(/^(\d{1,20})(?:\.(\d{1,6}))?$/);
  if (!match) return null;
  const fraction = (match[2] ?? "").padEnd(2, "0");
  if (fraction.slice(2).replace(/0/g, "") !== "") return null;
  const minor = BigInt(match[1]) * BigInt(100)
    + BigInt(fraction.slice(0, 2) || "0");
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}
