import type { FunnelLibraryIcon } from "./funnelIconCatalog";

const registry = new Map<string, FunnelLibraryIcon>();

export function registerFunnelLibraryIcons(icons: FunnelLibraryIcon[]): void {
  for (const icon of icons) {
    registry.set(icon.id, icon);
  }
}

export function getFunnelLibraryIcon(id: string): FunnelLibraryIcon | undefined {
  return registry.get(id);
}

export function listRegisteredFunnelLibraryIcons(): FunnelLibraryIcon[] {
  return Array.from(registry.values());
}
