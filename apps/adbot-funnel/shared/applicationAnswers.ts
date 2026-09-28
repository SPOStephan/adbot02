import type {
  ApplicationAnswerLabels,
  ApplicationRecord,
  ChoicePage,
  FunnelConfig,
  FunnelAnswers,
} from "./funnel";
import { stripFormattedText } from "./formattedText";

export type DisplayAnswer = {
  label: string;
  values: string[];
};

function isTechnicalAnswerKey(value: string) {
  return /^(?:question|page)-[a-z0-9-]{8,}$/i.test(value)
    || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value);
}

function choicePages(config: FunnelConfig | undefined): Map<string, ChoicePage> {
  return new Map(
    (config?.pages ?? [])
      .filter((page): page is ChoicePage => page.type === "choice-grid" || page.type === "choice-list")
      .map(page => [page.questionKey, page] as const),
  );
}

function visibleOptionLabel(label: string, fallback: string): string {
  return stripFormattedText(label).trim() || fallback;
}

/**
 * Captures the exact, human-readable option labels that were visible when the
 * application was submitted. Stable option values remain stored separately for
 * validation, lead scoring and backwards compatibility.
 */
export function snapshotApplicationAnswerLabels(
  config: FunnelConfig,
  answers: FunnelAnswers,
): ApplicationAnswerLabels {
  const pages = choicePages(config);
  const snapshots: ApplicationAnswerLabels = {};

  for (const [key, values] of Object.entries(answers)) {
    const page = pages.get(key);
    if (!page) continue;
    const optionLabels = new Map(
      page.options.map(option => [
        option.value,
        visibleOptionLabel(option.label, option.value),
      ] as const),
    );
    const selectedLabels: Record<string, string> = {};
    for (const value of values) {
      const label = optionLabels.get(value);
      if (label) selectedLabels[value] = label;
    }
    if (Object.keys(selectedLabels).length > 0) snapshots[key] = selectedLabels;
  }

  return snapshots;
}

/**
 * Resolves persisted answer keys and stable option values to their visible
 * customer wording. For new records, submission-time snapshots take priority;
 * legacy records fall back to the current funnel configuration.
 */
export function resolveApplicationAnswers(
  config: FunnelConfig | undefined,
  answers: ApplicationRecord["answers"],
  answerLabels?: ApplicationAnswerLabels,
): DisplayAnswer[] {
  const pages = choicePages(config);

  return Object.entries(answers).map(([key, values], index) => {
    const persistedLabel = key.trim();
    const page = pages.get(key);
    const optionLabels = new Map(
      (page?.options ?? []).map(option => [
        option.value,
        visibleOptionLabel(option.label, option.value),
      ] as const),
    );
    const snapshots = answerLabels?.[key];

    return {
      label:
        page?.name.trim()
        || (!isTechnicalAnswerKey(persistedLabel) && persistedLabel)
        || `Frage ${index + 1}`,
      values: values.map(value => snapshots?.[value] || optionLabels.get(value) || value),
    };
  });
}
