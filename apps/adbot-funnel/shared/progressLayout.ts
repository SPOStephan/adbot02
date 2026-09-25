import type {
  FunnelBrand,
  FunnelOptionIcon,
  FunnelPage,
  FunnelPageType,
  FunnelProgress,
  FunnelProgressColors,
  ProgressLayout,
} from "./funnel";
import { PROGRESS_LAYOUTS, visibleFunnelPages } from "./funnel";

export const DEFAULT_PROGRESS_LAYOUT: ProgressLayout = "percent";

export const EMPTY_PROGRESS_COLORS: FunnelProgressColors = {
  active: "",
  completed: "",
  upcoming: "",
  text: "",
  muted: "",
  track: "",
};

export const DEFAULT_PROGRESS: FunnelProgress = {
  layout: DEFAULT_PROGRESS_LAYOUT,
  colors: { ...EMPTY_PROGRESS_COLORS },
};

export const PROGRESS_LAYOUT_META: Array<{
  id: ProgressLayout;
  title: string;
  description: string;
}> = [
  { id: "percent", title: "Schritt & Prozent", description: "Die bisherige Anzeige: Schritt X von Y plus Fortschrittsbalken." },
  { id: "minimal", title: "Modern & minimal", description: "Nummerierte Kreise auf einer Linie mit Titel und Kurztext." },
  { id: "icons", title: "Mit Icons", description: "Icon-Kreise statt Zahlen, plus Titel und Kurztext." },
  { id: "bar", title: "Fortschrittsleiste", description: "Balken oben, darunter alle Stufen als nummerierte Liste." },
  { id: "chevrons", title: "Mit Labeln", description: "Pfeilsegmente mit Icon, Nummer und Text." },
  { id: "bold", title: "Nummern in Kreisen", description: "Große 01/02-Kreise, Titel in Versalien." },
  { id: "reduced", title: "Kompakt (Mobil)", description: "Nur die aktuelle Stufe, Pfeile und Balken." },
  { id: "illustrated", title: "Mit Illustrationen", description: "Farbige Icon-Kreise und verbindende Linie." },
  { id: "checks", title: "Elegant mit Häkchen", description: "Erledigte Stufen als Häkchen, aktuelle hervorgehoben." },
  { id: "chips", title: "Karten / Chips", description: "Jede Stufe als Karte, aktuelle eingefärbt." },
  { id: "brand", title: "Mit Branding-Linie", description: "Dekorative Linie, Icons und freie Stufentexte." },
];

export type ResolvedProgressStep = {
  id: string;
  title: string;
  hint: string;
  icon: FunnelOptionIcon;
  state: "completed" | "current" | "upcoming";
};

export type ResolvedProgressColors = {
  active: string;
  completed: string;
  upcoming: string;
  text: string;
  muted: string;
  track: string;
};

export function resolveProgressLayout(value?: string | null): ProgressLayout {
  return (PROGRESS_LAYOUTS as readonly string[]).includes(value ?? "")
    ? (value as ProgressLayout)
    : DEFAULT_PROGRESS_LAYOUT;
}

export function defaultProgressIcon(type: FunnelPageType): FunnelOptionIcon {
  if (type === "start") return "search";
  if (type === "contact") return "handshake";
  return "user-check";
}

export function resolveProgressStepCopy(page: Pick<FunnelPage, "name" | "eyebrow" | "title" | "type" | "progressTitle" | "progressHint" | "progressIcon">): {
  title: string;
  hint: string;
  icon: FunnelOptionIcon;
} {
  const title = page.progressTitle.trim() || page.name.trim() || page.title.trim() || "Schritt";
  const hint = page.progressHint.trim() || page.eyebrow.trim();
  const icon = page.progressIcon || defaultProgressIcon(page.type);
  return { title, hint, icon };
}

export function progressPercent(step: number, totalSteps: number): number {
  if (totalSteps <= 1) return 100;
  return Math.round((Math.max(0, step) / (totalSteps - 1)) * 100);
}

export function resolveProgressColors(
  brand: Pick<FunnelBrand, "accentColor" | "textColor">,
  colors?: Partial<FunnelProgressColors> | null,
): ResolvedProgressColors {
  const accent = brand.accentColor || "#0165c3";
  return {
    active: colors?.active || accent,
    completed: colors?.completed || accent,
    upcoming: colors?.upcoming || "#dbe6f0",
    text: colors?.text || brand.textColor || "#10253f",
    muted: colors?.muted || "#607287",
    track: colors?.track || "#dbe6f0",
  };
}

export function resolveProgressSteps(pages: FunnelPage[], step: number): ResolvedProgressStep[] {
  const visible = visibleFunnelPages(pages);
  const currentId = pages[step]?.id;
  const currentVisibleIndex = visible.findIndex(page => page.id === currentId);
  return visible.map((page, index) => {
    const copy = resolveProgressStepCopy(page);
    return {
      id: page.id,
      title: copy.title,
      hint: copy.hint,
      icon: copy.icon,
      state: currentVisibleIndex < 0
        ? "upcoming"
        : index < currentVisibleIndex ? "completed" : index === currentVisibleIndex ? "current" : "upcoming",
    };
  });
}

export function normalizeProgress(input?: Partial<FunnelProgress> | null): FunnelProgress {
  const colors = input?.colors ?? EMPTY_PROGRESS_COLORS;
  return {
    layout: resolveProgressLayout(input?.layout),
    colors: {
      active: hexOrEmpty(colors.active),
      completed: hexOrEmpty(colors.completed),
      upcoming: hexOrEmpty(colors.upcoming),
      text: hexOrEmpty(colors.text),
      muted: hexOrEmpty(colors.muted),
      track: hexOrEmpty(colors.track),
    },
  };
}

function hexOrEmpty(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : "";
}
