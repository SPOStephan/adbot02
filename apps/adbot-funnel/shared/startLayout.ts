import { BENEFITS_TILE_LAYOUTS, type BenefitsTileGap, type BenefitsTileLayout, type FunnelOptionIcon, type StartBadge, type StartBenefit, type StartPage, type StartPageLayout } from "./funnel";

export const DEFAULT_START_LAYOUT: StartPageLayout = "classic";
export const DEFAULT_BENEFITS_TILE_LAYOUT: BenefitsTileLayout = "two-column";
export const DEFAULT_BENEFITS_TILE_GAP: BenefitsTileGap = "medium";
export const DEFAULT_BENEFITS_SECTION_BACKGROUND = "#F4F8FC";
export const DEFAULT_BENEFITS_CARD_BACKGROUND = "#FFFFFF";
export const MAX_START_BENEFITS = 12;
export const MAX_START_BADGES = 16;
export const DEFAULT_HERO_BACKGROUND_OPACITY = 15;
export const DEFAULT_HERO_BACKGROUND_FOCUS_X = 50;
export const MAX_START_BENEFIT_TEXT = 800;

export const START_BADGE_TEMPLATES = [
  "Homeoffice",
  "Fixum + Provision",
  "10.000 €",
  "30 Tage Urlaub",
  "Firmenwagen",
  "Gleitzeit",
  "Weiterbildung",
  "Unbefristet",
] as const;

const DEFAULT_BENEFIT_SEEDS: Array<Pick<StartBenefit, "icon" | "title" | "text">> = [
  { icon: "adbot-vacation-days", title: "30 Tage Urlaub", text: "Ausreichend Zeit für Erholung, Familie und alles, was dir wichtig ist." },
  { icon: "adbot-profit-share", title: "Faire Vergütung", text: "Tarifliche Bezahlung plus Urlaubs- und Weihnachtsgeld." },
  { icon: "adbot-training-path", title: "Weiterbildung", text: "Coaching, Mentoring und Programme, die dich weiterbringen." },
  { icon: "adbot-mobile-work", title: "Mobiles Arbeiten", text: "Ortsunabhängig arbeiten, wenn es die Aufgabe erlaubt." },
  { icon: "adbot-flex-hours", title: "Flexible Arbeitszeiten", text: "Familienfreundliche Regelungen und individuelle Zeitmodelle." },
  { icon: "adbot-company-car", title: "Mobilität", text: "Firmenwagen oder Zuschuss – auch zur privaten Nutzung, wo vorgesehen." },
];

const FALLBACK_ICONS: FunnelOptionIcon[] = [
  "adbot-vacation-days",
  "adbot-profit-share",
  "adbot-training-path",
  "adbot-mobile-work",
  "adbot-flex-hours",
  "adbot-company-car",
];

export function resolveStartLayout(page: Pick<StartPage, "layout"> | { layout?: string }): StartPageLayout {
  return page.layout === "benefits" ? "benefits" : DEFAULT_START_LAYOUT;
}

export const BENEFITS_TILE_LAYOUT_META: Array<{
  id: BenefitsTileLayout;
  title: string;
  description: string;
}> = [
  {
    id: "two-column",
    title: "Zwei Spalten",
    description: "Icon oben, darunter Überschrift und kurzer Text. Zwei Kacheln pro Reihe.",
  },
  {
    id: "one-column",
    title: "Eine Spalte",
    description: "Icon links, rechts mehr Platz für Überschrift und längeren Text. Eine Kachel pro Reihe.",
  },
  {
    id: "cards",
    title: "Karten",
    description: "Wie eine Spalte, aber jeder Vorteil in einer abgerundeten Box. Bereichs- und Kartenfarbe frei wählbar.",
  },
];

export function resolveBenefitsTileLayout(value?: string | null): BenefitsTileLayout {
  return (BENEFITS_TILE_LAYOUTS as readonly string[]).includes(value ?? "")
    ? (value as BenefitsTileLayout)
    : DEFAULT_BENEFITS_TILE_LAYOUT;
}

export function resolveBenefitsSectionBackground(value?: string | null): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value.toUpperCase()
    : DEFAULT_BENEFITS_SECTION_BACKGROUND;
}

export function resolveBenefitsCardBackground(value?: string | null): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value.toUpperCase()
    : DEFAULT_BENEFITS_CARD_BACKGROUND;
}

export function resolveBenefitsTileGap(value?: string | null): BenefitsTileGap {
  if (value === "small" || value === "large") return value;
  return DEFAULT_BENEFITS_TILE_GAP;
}

export function emptyStartBadge(createId: () => string = () => crypto.randomUUID()): StartBadge {
  return { id: createId(), label: "Neues Badge" };
}

export function badgeFromTemplate(label: string, createId: () => string = () => crypto.randomUUID()): StartBadge {
  return { id: createId(), label: label.slice(0, 80) };
}

export function resolveBadgeColors(
  badge: Pick<StartBadge, "backgroundColor" | "textColor">,
  fallbackText: string,
): { background: string; text: string } {
  const background = badge.backgroundColor || "#ffffff";
  const text = badge.textColor || (badge.backgroundColor ? contrastOnAccent(background) : fallbackText);
  return { background, text };
}

export function defaultStartBenefits(createId: () => string = () => crypto.randomUUID()): StartBenefit[] {
  return DEFAULT_BENEFIT_SEEDS.map(seed => ({ ...seed, id: createId() }));
}

export function benefitsFromBullets(bullets: string[], createId: () => string = () => crypto.randomUUID()): StartBenefit[] {
  const lines = bullets.map(item => item.trim()).filter(Boolean);
  if (lines.length === 0) return defaultStartBenefits(createId);
  return lines.slice(0, MAX_START_BENEFITS).map((line, index) => ({
    id: createId(),
    icon: FALLBACK_ICONS[index % FALLBACK_ICONS.length]!,
    title: line.slice(0, 80),
    text: "",
  }));
}

export function emptyStartBenefit(createId: () => string = () => crypto.randomUUID()): StartBenefit {
  return { id: createId(), icon: "sparkles", title: "Neuer Vorteil", text: "" };
}

export function clampHeroBackgroundOpacity(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_HERO_BACKGROUND_OPACITY;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

export function clampHeroBackgroundFocusX(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_HERO_BACKGROUND_FOCUS_X;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

export function contrastOnAccent(accentColor: string) {
  const hex = accentColor.replace("#", "");
  if (hex.length !== 6) return "#ffffff";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? "#10253f" : "#ffffff";
}
