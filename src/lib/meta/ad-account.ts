/**
 * Content sync (Beitragsabruf) only needs Page + Instagram.
 * Ads/marketing use an explicitly selected Werbekonto when several exist.
 */

function normalizeAdAccountId(value: string): string {
  return value.trim().replace(/^act_/i, "");
}

export function resolveMarketingAdAccountId(input: {
  selectedAdAccountId: string | null | undefined;
  adAccountAssetIds: string[];
}): string | null {
  const assets = input.adAccountAssetIds
    .map((id) => id.trim())
    .filter(Boolean);
  if (!assets.length) return null;

  const selectedRaw = input.selectedAdAccountId?.trim() ?? "";
  if (selectedRaw) {
    const selectedNorm = normalizeAdAccountId(selectedRaw);
    const match = assets.find(
      (id) =>
        id === selectedRaw ||
        normalizeAdAccountId(id) === selectedNorm,
    );
    if (match) return match;
  }

  if (assets.length === 1) return assets[0] ?? null;
  return null;
}
