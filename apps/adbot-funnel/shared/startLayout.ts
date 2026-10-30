import { BENEFITS_TILE_LAYOUTS, type BenefitsTileGap, type BenefitsTileLayout, type FunnelOptionIcon, type HeroImageLayout, type StartBadge, type StartBadgeIconPosition, type StartBenefit, type StartPage, type StartButtonAlign, type StartPageLayout, type StartTextAlign } from "./funnel";
import { isSelectableFunnelIcon } from "./funnelIconCatalog";

export const DEFAULT_START_LAYOUT: StartPageLayout = "classic";
export const DEFAULT_BENEFITS_TILE_LAYOUT: BenefitsTileLayout = "two-column";
export const DEFAULT_BENEFITS_TILE_GAP: BenefitsTileGap = "medium";
export const DEFAULT_BENEFITS_SECTION_BACKGROUND = "#F4F8FC";
export const DEFAULT_BENEFITS_CARD_BACKGROUND = "#FFFFFF";
export const MAX_START_BENEFITS = 12;
export const MAX_START_BADGES = 16;
export const DEFAULT_HERO_BACKGROUND_OPACITY = 15;
export const DEFAULT_HERO_BACKGROUND_FOCUS_X = 50;
export const DEFAULT_HERO_IMAGE_LAYOUT: HeroImageLayout = "circle";
export const DEFAULT_HERO_IMAGE_RADIUS = 28;
export const MAX_HERO_IMAGE_RADIUS = 80;
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

function optionalStartHex(value?: string | null): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value.toUpperCase()
    : "";
}

export function resolveBenefitsSectionBackground(value?: string | null): string {
  return optionalStartHex(value) || DEFAULT_BENEFITS_SECTION_BACKGROUND;
}

/** Empty override = the general brand background. */
export function resolveHeroSectionBackground(value?: string | null, fallback?: string | null): string {
  return optionalStartHex(value) || optionalStartHex(fallback) || DEFAULT_BENEFITS_SECTION_BACKGROUND;
}

/** Valid custom hex, otherwise undefined so the canvas color remains visible. */
export function customHeroSectionBackground(value?: string | null): string | undefined {
  return optionalStartHex(value) || undefined;
}

export const HERO_GRADIENT_ANGLE = 170;
export const HERO_GRADIENT_MID_STOP = 40;

/**
 * Fill for the area above the Vorteile band (logo, progress and hero).
 * solid = one color per element; gradient = one linear gradient spanning the whole area,
 * slightly tilted (lightest top right) with an optional middle stop at 40 %.
 * Without a valid start color nothing is custom (canvas color stays visible).
 */
export function customHeroSectionFill(start?: string | null, end?: string | null, mid?: string | null): { solid?: string; gradient?: string } {
  const from = optionalStartHex(start);
  if (!from) return {};
  const to = optionalStartHex(end);
  if (!to) return { solid: from };
  const middle = optionalStartHex(mid);
  const stops = [`${from} 0%`, ...(middle ? [`${middle} ${HERO_GRADIENT_MID_STOP}%`] : []), `${to} 100%`];
  return { gradient: `linear-gradient(${HERO_GRADIENT_ANGLE}deg, ${stops.join(", ")})` };
}

export const DEFAULT_EYEBROW_BOX_BACKGROUND = "#FFCB2E";

/**
 * Colored box around the Überzeile of a start page ("Wir suchen Dich!").
 * Without a valid box color the Überzeile stays plain text, so existing funnels are unchanged.
 */
export function resolveEyebrowBox(background?: string | null, text?: string | null): { background: string; color: string } | undefined {
  const fill = optionalStartHex(background);
  if (!fill) return undefined;
  return { background: fill, color: optionalStartHex(text) || contrastOnAccent(fill) };
}

export function resolveBenefitsCardBackground(value?: string | null): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value.toUpperCase()
    : DEFAULT_BENEFITS_CARD_BACKGROUND;
}

export function resolveHeroImageLayout(value?: string | null): HeroImageLayout {
  return value === "wide" ? "wide" : DEFAULT_HERO_IMAGE_LAYOUT;
}

export function clampHeroImageRadius(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_HERO_IMAGE_RADIUS;
  return Math.max(0, Math.min(MAX_HERO_IMAGE_RADIUS, Math.round(numeric)));
}

export function resolveBenefitsTileGap(value?: string | null): BenefitsTileGap {
  if (value === "small" || value === "large") return value;
  return DEFAULT_BENEFITS_TILE_GAP;
}

export const DEFAULT_BADGE_ICON_POSITION: StartBadgeIconPosition = "left";

export function emptyStartBadge(createId: () => string = () => crypto.randomUUID()): StartBadge {
  return { id: createId(), label: "Neues Badge", icon: "", iconPosition: DEFAULT_BADGE_ICON_POSITION };
}

export function badgeFromTemplate(label: string, createId: () => string = () => crypto.randomUUID()): StartBadge {
  return { id: createId(), label: label.slice(0, 80), icon: "", iconPosition: DEFAULT_BADGE_ICON_POSITION };
}

export function resolveBadgeIcon(icon?: string | null): string {
  return typeof icon === "string" && isSelectableFunnelIcon(icon) ? icon : "";
}

export function resolveBadgeIconPosition(value?: string | null): StartBadgeIconPosition {
  return value === "right" ? "right" : DEFAULT_BADGE_ICON_POSITION;
}

export function moveStartBadge(badges: StartBadge[], fromId: string, toId: string): StartBadge[] {
  if (fromId === toId) return badges;
  const from = badges.findIndex(badge => badge.id === fromId);
  const to = badges.findIndex(badge => badge.id === toId);
  if (from < 0 || to < 0) return badges;
  const next = [...badges];
  const [moved] = next.splice(from, 1);
  if (!moved) return badges;
  next.splice(to, 0, moved);
  return next;
}

export function patchStartBadge(badges: StartBadge[], id: string, next: Partial<StartBadge>): StartBadge[] {
  return badges.map(item => item.id === id ? { ...item, ...next } : item);
}

/** Stored as badge backgroundColor: no fill, the section background (e.g. a gradient) shows through. */
export const BADGE_TRANSPARENT_BACKGROUND = "transparent";

export function isTransparentBadgeBackground(value?: string | null): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === BADGE_TRANSPARENT_BACKGROUND;
}

/** Valid hex, "transparent", or "" (default light chip). */
export function normalizeBadgeBackground(value?: string | null): string {
  if (isTransparentBadgeBackground(value)) return BADGE_TRANSPARENT_BACKGROUND;
  return optionalStartHex(value);
}

export function resolveBadgeColors(
  badge: Pick<StartBadge, "backgroundColor" | "textColor">,
  fallbackText: string,
  brandAccent?: string,
): { background: string; text: string } {
  const explicit = optionalStartHex(badge.textColor);
  if (isTransparentBadgeBackground(badge.backgroundColor)) {
    return { background: BADGE_TRANSPARENT_BACKGROUND, text: explicit || optionalStartHex(fallbackText) || "#10253F" };
  }
  const background = optionalStartHex(badge.backgroundColor) || "#FFFFFF";
  if (explicit) return { background, text: explicit };
  const hasCustomBackground = Boolean(optionalStartHex(badge.backgroundColor));
  const accent = optionalStartHex(brandAccent);
  if (hasCustomBackground) {
    if (accent && accent !== background) return { background, text: accent };
    return { background, text: contrastOnAccent(background) };
  }
  return { background, text: optionalStartHex(fallbackText) || "#10253F" };
}

/** Chip outline: own color, else the fill for custom colors, a soft text-colored line when transparent, else the given default. */
export function resolveBadgeBorderColor(
  badge: Pick<StartBadge, "backgroundColor" | "borderColor">,
  textColor: string,
  fallback: string,
): string {
  const own = optionalStartHex(badge.borderColor);
  if (own) return own;
  if (isTransparentBadgeBackground(badge.backgroundColor)) return `color-mix(in srgb, ${textColor} 35%, transparent)`;
  return optionalStartHex(badge.backgroundColor) || fallback;
}

/** Editor-only chip fill: a transparent badge with light text would vanish on the white editor, so it gets a dark backdrop. */
export function badgeEditorBackground(badge: Pick<StartBadge, "backgroundColor">, textColor: string, background: string): string {
  if (!isTransparentBadgeBackground(badge.backgroundColor)) return background;
  return isLightColor(textColor) ? "#334155" : background;
}

/** Light hex (e.g. white text) that would be unreadable on white. */
export function isLightColor(value: string): boolean {
  return contrastOnAccent(value) !== "#ffffff";
}

export function resolveStartTextAlign(value?: string | null): StartTextAlign {
  return value === "left" ? "left" : "center";
}

/** Extra class for left-aligned header elements; centered stays class-free. */
export function startAlignClass(value?: string | null): string {
  return resolveStartTextAlign(value) === "left" ? " is-align-left" : "";
}

export const DEFAULT_BADGE_BORDER_WIDTH = 1;
export const MAX_BADGE_BORDER_WIDTH = 8;

/** Whole pixels 0–8; missing/invalid = 1 px (previous fixed outline). */
export function resolveBadgeBorderWidth(value?: number | null): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_BADGE_BORDER_WIDTH;
  return Math.min(MAX_BADGE_BORDER_WIDTH, Math.max(0, Math.round(value)));
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

export type ResolvedButtonColors = {
  background: string;
  text: string;
  /** Undefined keeps the stylesheet's default hover shade. */
  hover?: string;
};

/** Primary button colors; empty values fall back to the shared accent so legacy funnels look unchanged. */
export function resolveButtonColors(brand: { accentColor: string; buttonColor?: string; buttonTextColor?: string }): ResolvedButtonColors {
  const custom = brand.buttonColor?.trim() ?? "";
  const background = custom || brand.accentColor || "#0165c3";
  const text = brand.buttonTextColor?.trim() || (custom ? contrastOnAccent(custom) : "#ffffff");
  return { background, text, hover: custom ? `color-mix(in srgb, ${custom} 82%, black)` : undefined };
}

/**
 * CSS variables for one button that overrides the global button colors.
 * Empty values keep the inherited Branding → Buttons setting.
 */
export const MAX_BUTTON_RADIUS = 60;

/** Whole px 0–60; anything else = undefined (layout default: 14 px, pill on the benefits start page). */
export function resolveButtonRadius(value?: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(MAX_BUTTON_RADIUS, Math.max(0, Math.round(value)));
}

export function resolveStartButtonAlign(value?: string | null): StartButtonAlign {
  return value === "left" || value === "full" ? value : "center";
}

export function buttonOverrideVars(color?: string, textColor?: string, radius?: number): Record<string, string> | undefined {
  const background = color?.trim() ?? "";
  const text = textColor?.trim() || (background ? contrastOnAccent(background) : "");
  const corner = resolveButtonRadius(radius);
  if (!background && !text && corner === undefined) return undefined;
  return {
    ...(background ? { "--funnel-button": background, "--funnel-button-hover": `color-mix(in srgb, ${background} 82%, black)` } : {}),
    ...(text ? { "--funnel-button-text": text } : {}),
    ...(corner !== undefined ? { borderRadius: `${corner}px` } : {}),
  };
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
