import { clampCopySizeStep, DEFAULT_COPY_SIZE_STEP } from "./copySize";
import type { StartPage, StartRequirementItem, StartRequirements, StartRequirementsIconStyle } from "./funnel";
import { isSelectableFunnelIcon } from "./funnelIconCatalog";
import { stripFormattedText } from "./formattedText";

export const MAX_START_REQUIREMENTS = 12;
export const MAX_START_REQUIREMENT_TEXT = 240;
export const DEFAULT_REQUIREMENTS_ICON = "check";
export const DEFAULT_REQUIREMENTS_ICON_STYLE: StartRequirementsIconStyle = "filled";
export const DEFAULT_REQUIREMENTS_TITLE = "Das bringst Du mit:";

const HEX = /^#[0-9a-fA-F]{6}$/;

function hexOrEmpty(value: unknown): string {
  return typeof value === "string" && HEX.test(value) ? value.toUpperCase() : "";
}

export function emptyStartRequirementItem(text = "Neuer Punkt", createId: () => string = () => crypto.randomUUID()): StartRequirementItem {
  return { id: createId(), text };
}

/** Switched-off section with sample content, so turning it on shows something right away. */
export function defaultStartRequirements(createId: () => string = () => crypto.randomUUID()): StartRequirements {
  return {
    enabled: false,
    title: DEFAULT_REQUIREMENTS_TITLE,
    items: ["Erste Erfahrung im Vertrieb", "Freude am Kundenkontakt", "Lust auf eine Festanstellung"].map(text => emptyStartRequirementItem(text, createId)),
    icon: DEFAULT_REQUIREMENTS_ICON,
    iconStyle: DEFAULT_REQUIREMENTS_ICON_STYLE,
    iconColor: "",
    iconGlyphColor: "",
    titleColor: "",
    textColor: "",
    background: "",
    titleSizeStep: DEFAULT_COPY_SIZE_STEP,
    textSizeStep: DEFAULT_COPY_SIZE_STEP,
  };
}

export function resolveStartRequirements(value: Partial<StartRequirements> | null | undefined): StartRequirements {
  const fallback = defaultStartRequirements();
  if (!value || typeof value !== "object") return fallback;
  const items = Array.isArray(value.items)
    ? value.items
      .filter(item => item && typeof item.text === "string")
      .slice(0, MAX_START_REQUIREMENTS)
      .map(item => ({
        id: typeof item.id === "string" && item.id ? item.id : crypto.randomUUID(),
        text: item.text.slice(0, MAX_START_REQUIREMENT_TEXT * 4),
      }))
    : fallback.items;
  return {
    enabled: value.enabled === true,
    title: typeof value.title === "string" ? value.title : fallback.title,
    items,
    icon: typeof value.icon === "string" && isSelectableFunnelIcon(value.icon) ? value.icon : DEFAULT_REQUIREMENTS_ICON,
    iconStyle: value.iconStyle === "plain" ? "plain" : "filled",
    iconColor: hexOrEmpty(value.iconColor),
    iconGlyphColor: hexOrEmpty(value.iconGlyphColor),
    titleColor: hexOrEmpty(value.titleColor),
    textColor: hexOrEmpty(value.textColor),
    background: hexOrEmpty(value.background),
    titleSizeStep: clampCopySizeStep(value.titleSizeStep),
    textSizeStep: clampCopySizeStep(value.textSizeStep),
  };
}

/** Rendered only when switched on and at least one item has text. */
export function visibleStartRequirements(page: Pick<StartPage, "requirements">): StartRequirements | null {
  const requirements = page.requirements;
  if (!requirements?.enabled) return null;
  const items = (requirements.items ?? []).filter(item => stripFormattedText(item.text));
  if (items.length === 0) return null;
  return { ...resolveStartRequirements(requirements), items };
}
