import type { ApplicationContact, ChoicePage, FunnelAnswers, FunnelGate, FunnelOption, FunnelPage } from "./funnel";

export const DEFAULT_FUNNEL_GATE: FunnelGate = {
  exitTitle: "Danke für dein Interesse",
  exitText: "Im Moment passt das leider nicht – aber wir behalten dich gerne im Blick.",
  handoffTitle: "Eine andere Stelle könnte besser passen",
  handoffText: "Für diesen Job ist eine andere Voraussetzung nötig. {targetTitle} könnte zu dir passen.",
};

export const FUNNEL_HANDOFF_STORAGE_KEY = "adbot-funnel-handoff";

export type FunnelHandoffPayload = {
  sourceFunnelId: string;
  sourceSlug: string;
  sourceTitle: string;
  targetFunnelId: string;
  answers: FunnelAnswers;
  contact: ApplicationContact;
};

export type ResolvedKnockout = {
  option: FunnelOption;
  action: "exit" | "handoff";
  handoffFunnelId: string;
};

export function normalizeFunnelGate(input?: Partial<FunnelGate> | null): FunnelGate {
  return {
    exitTitle: typeof input?.exitTitle === "string" && input.exitTitle.trim() ? input.exitTitle.slice(0, 300) : DEFAULT_FUNNEL_GATE.exitTitle,
    exitText: typeof input?.exitText === "string" && input.exitText.trim() ? input.exitText.slice(0, 1200) : DEFAULT_FUNNEL_GATE.exitText,
    handoffTitle: typeof input?.handoffTitle === "string" && input.handoffTitle.trim() ? input.handoffTitle.slice(0, 300) : DEFAULT_FUNNEL_GATE.handoffTitle,
    handoffText: typeof input?.handoffText === "string" && input.handoffText.trim() ? input.handoffText.slice(0, 1200) : DEFAULT_FUNNEL_GATE.handoffText,
  };
}

export function normalizeKnockoutOption(option: Partial<FunnelOption>): Pick<FunnelOption, "knockout" | "knockoutAction" | "handoffFunnelId"> {
  const knockout = option.knockout === true;
  const action = option.knockoutAction === "handoff" ? "handoff" : "exit";
  const handoffFunnelId = typeof option.handoffFunnelId === "string" ? option.handoffFunnelId : "";
  return {
    knockout,
    knockoutAction: knockout && action === "handoff" && handoffFunnelId ? "handoff" : "exit",
    handoffFunnelId: knockout && action === "handoff" ? handoffFunnelId : "",
  };
}

export function resolveKnockout(page: ChoicePage, selected: string[]): ResolvedKnockout | null {
  const hit = page.options.find(option => option.knockout && selected.includes(option.value));
  if (!hit) return null;
  const action = hit.knockoutAction === "handoff" && hit.handoffFunnelId ? "handoff" : "exit";
  return { option: hit, action, handoffFunnelId: action === "handoff" ? hit.handoffFunnelId : "" };
}

export function fillGateText(template: string, vars: { targetTitle?: string; sourceTitle?: string }): string {
  return template
    .replaceAll("{targetTitle}", vars.targetTitle?.trim() || "eine andere Stelle")
    .replaceAll("{sourceTitle}", vars.sourceTitle?.trim() || "diese Stelle");
}

export function firstUnansweredStep(pages: FunnelPage[], answers: FunnelAnswers): number {
  const index = pages.findIndex(page => {
    if (page.type !== "choice-grid" && page.type !== "choice-list") return false;
    return (answers[page.questionKey] ?? []).length === 0;
  });
  if (index >= 0) return index;
  const contact = pages.findIndex(page => page.type === "contact");
  return contact >= 0 ? contact : 0;
}

export function mergeHandoffAnswers(current: FunnelAnswers, incoming?: FunnelAnswers | null): FunnelAnswers {
  if (!incoming) return current;
  return { ...incoming, ...current };
}
