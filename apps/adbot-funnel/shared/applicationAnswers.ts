import type { ApplicationRecord, ChoicePage, FunnelConfig } from "./funnel";

export type DisplayAnswer = {
  label: string;
  values: string[];
};

function isTechnicalAnswerKey(value: string) {
  return /^(?:question|page)-[a-z0-9-]{8,}$/i.test(value)
    || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value);
}

/**
 * Resolves persisted answer keys against the current funnel configuration.
 * Human-readable legacy keys remain readable; stale technical keys are never
 * exposed in user-facing output.
 */
export function resolveApplicationAnswers(
  config: FunnelConfig | undefined,
  answers: ApplicationRecord["answers"],
): DisplayAnswer[] {
  const pageNames = new Map(
    (config?.pages ?? [])
      .filter((page): page is ChoicePage => page.type === "choice-grid" || page.type === "choice-list")
      .map(page => [page.questionKey, page.name.trim()] as const),
  );

  return Object.entries(answers).map(([key, values], index) => {
    const persistedLabel = key.trim();
    const configuredLabel = pageNames.get(key);
    return {
      label: configuredLabel || (!isTechnicalAnswerKey(persistedLabel) && persistedLabel) || `Frage ${index + 1}`,
      values,
    };
  });
}
