/** Every editor image lives under funnels/. Applications stay private. */
export function isPublicFunnelStorageKey(key: string): boolean {
  const normalized = key.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!normalized || normalized.includes("..")) return false;
  return normalized === "funnels" || normalized.startsWith("funnels/");
}

export function assertPublicFunnelImageUrl(url: string): void {
  const href = url.trim();
  if (/^https:\/\//i.test(href)) return;
  if (!href.startsWith("/api/storage/")) {
    throw new Error("Editor-Bild muss öffentlich unter /api/storage/funnels/ oder per HTTPS liegen.");
  }
  const key = href.slice("/api/storage/".length);
  if (!isPublicFunnelStorageKey(key)) {
    throw new Error("Editor-Bild darf nicht im privaten Speicher landen.");
  }
}
