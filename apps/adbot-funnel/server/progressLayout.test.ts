import { describe, expect, it } from "vitest";
import { defaultFunnel } from "@shared/defaultFunnel";
import { funnelConfigSchema } from "@shared/funnelSchemas";
import {
  DEFAULT_PROGRESS_LAYOUT,
  defaultProgressStages,
  normalizeProgress,
  progressPercent,
  resolveProgressColors,
  resolveProgressLayout,
  resolveProgressSegments,
  resolveProgressStepCopy,
  resolveProgressSteps,
} from "@shared/progressLayout";
import { normalizeFunnelConfig } from "./funnelStore";

describe("Fortschrittsanzeige", () => {
  it("fällt ohne Angabe auf Schritt & Prozent zurück", () => {
    expect(resolveProgressLayout("minimal")).toBe("minimal");
    expect(resolveProgressLayout("unknown")).toBe(DEFAULT_PROGRESS_LAYOUT);
    expect(resolveProgressLayout(undefined)).toBe("percent");
    expect(progressPercent(0, 4)).toBe(0);
    expect(progressPercent(3, 4)).toBe(100);
  });

  it("nutzt Brandingfarben, wenn keine Elementfarben gesetzt sind", () => {
    const colors = resolveProgressColors(defaultFunnel.brand, defaultFunnel.progress.colors);
    expect(colors.active).toBe(defaultFunnel.brand.accentColor);
    expect(colors.completed).toBe(defaultFunnel.brand.accentColor);
    expect(colors.text).toBe(defaultFunnel.brand.textColor);
  });

  it("übernimmt eigene Elementfarben", () => {
    const colors = resolveProgressColors(defaultFunnel.brand, {
      active: "#C8102E",
      completed: "#0B6E4F",
      upcoming: "",
      text: "",
      muted: "",
      track: "",
    });
    expect(colors.active).toBe("#C8102E");
    expect(colors.completed).toBe("#0B6E4F");
    expect(colors.upcoming).toBe("#c5d3e0");
  });

  it("nimmt Stufentexte vom Editor, sonst Seitenname", () => {
    const start = defaultFunnel.pages[0]!;
    expect(resolveProgressStepCopy(start)).toMatchObject({
      title: "Job-Check",
      hint: "Passt der Job zu dir?",
      icon: "search",
    });
    expect(resolveProgressStepCopy({ ...start, progressTitle: "", progressHint: "", progressIcon: "rocket" })).toMatchObject({
      title: start.name,
      hint: start.eyebrow,
      icon: "rocket",
    });
  });

  it("markiert abgeschlossene, aktuelle und kommende Stufen", () => {
    const steps = resolveProgressSteps(defaultFunnel.pages, 1);
    expect(steps.map(item => item.state)).toEqual(["completed", "current", "upcoming", "upcoming"]);
  });

  it("lässt ausgeblendete Seiten in der Fortschrittsanzeige weg", () => {
    const pages = defaultFunnel.pages.map(page => page.id === "page-role" ? { ...page, hidden: true } : page);
    const steps = resolveProgressSteps(pages, 2);
    expect(steps.map(item => item.id)).toEqual(["page-start", "page-experience", "page-contact"]);
    expect(steps.map(item => item.state)).toEqual(["completed", "current", "upcoming"]);
  });

  it("akzeptiert Varianten und leere Farb-Overrides im Schema", () => {
    expect(funnelConfigSchema.safeParse({
      ...defaultFunnel,
      progress: {
        layout: "segments",
        colors: { active: "#004D98", completed: "", upcoming: "", text: "", muted: "", track: "" },
        stages: [
          { id: "s1", label: "Bewerbung", startPageId: "page-start" },
          { id: "s2", label: "Matching", startPageId: "page-role" },
          { id: "s3", label: "Kennenlernen", startPageId: "page-contact" },
        ],
      },
    }).success).toBe(true);
    expect(funnelConfigSchema.safeParse({
      ...defaultFunnel,
      progress: {
        layout: "checks",
        colors: { active: "#004D98", completed: "", upcoming: "", text: "", muted: "", track: "" },
      },
    }).success).toBe(true);
    expect(funnelConfigSchema.safeParse({
      ...defaultFunnel,
      progress: { layout: "unknown", colors: defaultFunnel.progress.colors },
    }).success).toBe(false);
  });

  it("normalisiert Bestandsfunnels ohne Fortschrittsfelder", () => {
    const legacy = structuredClone(defaultFunnel) as Record<string, unknown>;
    delete legacy.progress;
    for (const page of (legacy.pages as Array<Record<string, unknown>>)) {
      delete page.progressTitle;
      delete page.progressHint;
      delete page.progressIcon;
    }
    const normalized = normalizeFunnelConfig(legacy as typeof defaultFunnel, true);
    expect(normalized.progress).toEqual(normalizeProgress(undefined));
    expect(normalized.pages[0]?.progressTitle).toBe("");
    expect(normalized.pages[0]?.progressIcon).toBe("search");
    expect(normalized.pages.at(-1)?.progressIcon).toBe("handshake");
  });

  it("fällt ohne konfigurierte Stufen auf die drei Standard-Balken zurück", () => {
    const steps = resolveProgressSegments(defaultFunnel.pages, 0, []);
    expect(steps.map(item => item.title)).toEqual(["Job-Check", "Kurzprofil", "Kennenlernen"]);
    expect(steps.map(item => item.state)).toEqual(["current", "upcoming", "upcoming"]);
  });

  it("legt drei Balken an: Aufruf, zweite Seite, Adresseingabe", () => {
    const stages = defaultProgressStages(defaultFunnel.pages);
    expect(stages.map(stage => stage.startPageId)).toEqual(["page-start", "page-role", "page-contact"]);
    expect(stages.map(stage => stage.label)).toEqual(["Job-Check", "Kurzprofil", "Kennenlernen"]);
    expect(resolveProgressSegments(defaultFunnel.pages, 0, stages).map(item => item.state)).toEqual(["current", "upcoming", "upcoming"]);
    expect(resolveProgressSegments(defaultFunnel.pages, 1, stages).map(item => item.state)).toEqual(["completed", "current", "upcoming"]);
    expect(resolveProgressSegments(defaultFunnel.pages, 2, stages).map(item => item.state)).toEqual(["completed", "current", "upcoming"]);
    expect(resolveProgressSegments(defaultFunnel.pages, 3, stages).map(item => item.state)).toEqual(["completed", "completed", "current"]);
  });
});
