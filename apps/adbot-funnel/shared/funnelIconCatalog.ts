import { ADBOT_FUNNEL_ICONS, FUNNEL_OPTION_ICON_LABELS, FUNNEL_OPTION_ICONS, LUCIDE_FUNNEL_ICONS, type FunnelOptionIcon } from "./funnel";

/** Lucide-Einträge, die ein spezifischeres Adbot-Icon bereits abdeckt. */
export const HIDDEN_PICKER_ICONS = new Set<FunnelOptionIcon>(["car"]);

export const FUNNEL_ICON_SEARCH_ALIASES: Partial<Record<FunnelOptionIcon, readonly string[]>> = {
  "adbot-company-car": ["auto", "wagen", "dienstwagen", "firmenwagen", "pkw", "car"],
  "adbot-home-office": ["homeoffice", "heimarbeit", "zuhause arbeiten"],
  "adbot-vacation-days": ["urlaub", "erholung", "freie tage"],
  "adbot-flex-hours": ["gleitzeit", "arbeitszeit", "flexibel"],
  "adbot-training-path": ["weiterbildung", "schulung", "lernen"],
  "adbot-team-together": ["team", "kollegen", "gemeinschaft"],
  "adbot-health-care": ["gesundheit", "vorsorge"],
  "adbot-insurance-cover": ["versicherung", "absicherung"],
  "adbot-travel-equals-work": ["reise", "fahrtzeit", "dienstreise"],
  "adbot-mobile-work": ["mobil", "remote", "ortsunabhängig"],
};

const CUSTOM_ICON_ID = /^adbot-custom-[a-z0-9-]{4,48}$/;

export type FunnelLibraryIconStatus = "ready" | "requested";

export type FunnelLibraryIcon = {
  id: string;
  label: string;
  svg: string;
  aliases: string[];
  status: FunnelLibraryIconStatus;
  requestNote: string;
};

export function isCustomFunnelIconId(value: string): boolean {
  return CUSTOM_ICON_ID.test(value);
}

export function isBuiltInFunnelIcon(value: string): value is FunnelOptionIcon {
  return (FUNNEL_OPTION_ICONS as readonly string[]).includes(value);
}

export function isSelectableFunnelIcon(value: string): boolean {
  return isBuiltInFunnelIcon(value) || isCustomFunnelIconId(value);
}

export function visiblePickerIcons(): FunnelOptionIcon[] {
  return FUNNEL_OPTION_ICONS.filter(icon => !HIDDEN_PICKER_ICONS.has(icon));
}

export function iconSearchHaystack(icon: FunnelOptionIcon): string {
  const aliases = FUNNEL_ICON_SEARCH_ALIASES[icon] ?? [];
  return `${FUNNEL_OPTION_ICON_LABELS[icon]} ${icon} ${aliases.join(" ")}`.toLocaleLowerCase("de");
}

export function filterPickerIcons(query: string): FunnelOptionIcon[] {
  const needle = query.trim().toLocaleLowerCase("de");
  const catalog = visiblePickerIcons();
  if (!needle) return catalog;
  return catalog.filter(icon => iconSearchHaystack(icon).includes(needle));
}

export function filterLibraryIcons(icons: FunnelLibraryIcon[], query: string): FunnelLibraryIcon[] {
  const needle = query.trim().toLocaleLowerCase("de");
  if (!needle) return icons.filter(icon => icon.status === "ready" || icon.svg);
  return icons.filter(icon => `${icon.label} ${icon.id} ${icon.aliases.join(" ")} ${icon.requestNote}`.toLocaleLowerCase("de").includes(needle));
}

export { LUCIDE_FUNNEL_ICONS, ADBOT_FUNNEL_ICONS };
