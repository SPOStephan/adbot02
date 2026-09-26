import type {
  FunnelBrand,
  FunnelOptionIcon,
  FunnelPage,
  FunnelPageType,
  FunnelProgress,
  FunnelProgressColors,
  FunnelProgressStage,
  ProgressLayout,
} from "./funnel";
import { PROGRESS_LAYOUTS, visibleFunnelPages } from "./funnel";
import { stripFormattedText } from "./formattedText";

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
  stages: [],
};

export const MAX_PROGRESS_STAGES = 6;

export const PROGRESS_LAYOUT_META: Array<{
  id: ProgressLayout;
  title: string;
  description: string;
}> = [
  { id: "percent", title: "Schritt & Prozent", description: "Die bisherige Anzeige: Schritt X von Y plus Fortschrittsbalken." },
  { id: "segments", title: "Beschriftete Balken", description: "Getrennte Balken mit Label. Anzahl, Farbe und Startseite jeder Stufe sind frei wählbar." },
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
  icon: string;
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
  icon: string;
} {
  const title = page.progressTitle.trim() || page.name.trim() || stripFormattedText(page.title) || "Schritt";
  const hint = page.progressHint.trim() || stripFormattedText(page.eyebrow);
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

export function defaultProgressStages(pages: FunnelPage[]): FunnelProgressStage[] {
  const visible = visibleFunnelPages(pages);
  if (visible.length === 0) return [];
  const first = visible[0]!;
  const second = visible[1];
  const last = visible[visible.length - 1]!;
  const stages: FunnelProgressStage[] = [{
    id: `stage-${first.id}`,
    label: resolveProgressStepCopy(first).title,
    startPageId: first.id,
  }];
  if (second && second.id !== first.id) {
    stages.push({
      id: `stage-${second.id}`,
      label: resolveProgressStepCopy(second).title,
      startPageId: second.id,
    });
  }
  if (last.id !== first.id && last.id !== second?.id) {
    stages.push({
      id: `stage-${last.id}`,
      label: resolveProgressStepCopy(last).title,
      startPageId: last.id,
    });
  }
  return stages;
}

export function resolveProgressSegments(
  pages: FunnelPage[],
  step: number,
  stages?: FunnelProgressStage[] | null,
): ResolvedProgressStep[] {
  const visible = visibleFunnelPages(pages);
  if (visible.length === 0) return [];
  const configured = (stages ?? []).filter(stage => stage.startPageId && visible.some(page => page.id === stage.startPageId));
  const source = configured.length > 0 ? configured : visible.map(page => ({
    id: page.id,
    label: resolveProgressStepCopy(page).title,
    startPageId: page.id,
  }));
  const unique: Array<FunnelProgressStage & { startIndex: number }> = [];
  for (const stage of source) {
    const startIndex = visible.findIndex(page => page.id === stage.startPageId);
    if (startIndex < 0 || unique.some(item => item.startIndex === startIndex)) continue;
    unique.push({
      id: stage.id || `stage-${stage.startPageId}`,
      label: stage.label.trim() || resolveProgressStepCopy(visible[startIndex]!).title,
      startPageId: stage.startPageId,
      startIndex,
    });
  }
  unique.sort((left, right) => left.startIndex - right.startIndex);
  const currentId = pages[step]?.id;
  const currentVisibleIndex = visible.findIndex(page => page.id === currentId);
  return unique.map((stage, index) => {
    const nextStart = unique[index + 1]?.startIndex ?? visible.length;
    const state = currentVisibleIndex < 0
      ? "upcoming"
      : currentVisibleIndex >= nextStart
        ? "completed"
        : currentVisibleIndex >= stage.startIndex
          ? "current"
          : "upcoming";
    return { id: stage.id, title: stage.label, hint: "", icon: "", state };
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
    stages: normalizeProgressStages(input?.stages),
  };
}

export function normalizeProgressStages(input?: FunnelProgressStage[] | null): FunnelProgressStage[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const stages: FunnelProgressStage[] = [];
  for (const item of input) {
    if (stages.length >= MAX_PROGRESS_STAGES) break;
    const startPageId = typeof item?.startPageId === "string" ? item.startPageId.trim() : "";
    const label = typeof item?.label === "string" ? item.label.trim().slice(0, 40) : "";
    const id = typeof item?.id === "string" && item.id.trim() ? item.id.trim().slice(0, 80) : "";
    if (!startPageId || seen.has(startPageId)) continue;
    seen.add(startPageId);
    stages.push({
      id: id || `stage-${startPageId}`,
      label,
      startPageId,
    });
  }
  return stages;
}

function hexOrEmpty(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : "";
}
