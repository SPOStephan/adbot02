const SAFE_ORIGIN = "https://adbot.invalid";
const DEFAULT_NEXT_PATH = "/dashboard";

export function normalizeSafeNextPath(
  value: string | null | undefined,
  fallback = DEFAULT_NEXT_PATH,
): string {
  const candidate = value?.trim();
  if (
    !candidate ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    /%2f|%5c/i.test(candidate)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(candidate, SAFE_ORIGIN);
    if (parsed.origin !== SAFE_ORIGIN || !parsed.pathname.startsWith("/")) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
