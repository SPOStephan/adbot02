import type { FunnelOptionIcon, StartBenefit, StartPage, StartPageLayout } from "./funnel";

export const DEFAULT_START_LAYOUT: StartPageLayout = "classic";
export const MAX_START_BENEFITS = 12;
export const DEFAULT_HERO_BACKGROUND_OPACITY = 15;

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

export function defaultStartBenefits(createId = () => crypto.randomUUID()): StartBenefit[] {
  return DEFAULT_BENEFIT_SEEDS.map(seed => ({ ...seed, id: createId() }));
}

export function benefitsFromBullets(bullets: string[], createId = () => crypto.randomUUID()): StartBenefit[] {
  const lines = bullets.map(item => item.trim()).filter(Boolean);
  if (lines.length === 0) return defaultStartBenefits(createId);
  return lines.slice(0, MAX_START_BENEFITS).map((line, index) => ({
    id: createId(),
    icon: FALLBACK_ICONS[index % FALLBACK_ICONS.length]!,
    title: line.slice(0, 80),
    text: "",
  }));
}

export function emptyStartBenefit(createId = () => crypto.randomUUID()): StartBenefit {
  return { id: createId(), icon: "sparkles", title: "Neuer Vorteil", text: "" };
}

export function clampHeroBackgroundOpacity(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_HERO_BACKGROUND_OPACITY;
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
