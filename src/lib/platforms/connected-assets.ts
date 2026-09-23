export type PlatformConnectedAssetItem = {
  id: string;
  name: string;
  badge?: string;
};

export type PlatformConnectedAssetGroup = {
  label: string;
  pluralLabel: string;
  items: PlatformConnectedAssetItem[];
};

export function summarizeConnectedAssetGroups(
  groups: readonly PlatformConnectedAssetGroup[],
): string {
  return groups
    .filter((group) => group.items.length > 0)
    .map((group) => {
      const count = group.items.length;
      return `${count} ${count === 1 ? group.label : group.pluralLabel}`;
    })
    .join(" · ");
}
