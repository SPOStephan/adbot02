import type {
  ApplicationAnswerLabels,
  ApplicationQuestionLabels,
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
 * The question exactly as the applicant read it on the funnel page: the page
 * headline, falling back to the subtitle and finally the internal page name.
 */
export function visibleQuestionLabel(page: ChoicePage): string {
  return stripFormattedText(page.title ?? "")
    || stripFormattedText(page.subtitle ?? "")
    || page.name.trim();
}

/**
 * Captures the question wording visible at submission time, so later edits to
 * the funnel do not change what an application shows as its question.
 */
export function snapshotApplicationQuestionLabels(
  config: FunnelConfig,
  answers: FunnelAnswers,
): ApplicationQuestionLabels {
  const pages = choicePages(config);
  const snapshots: ApplicationQuestionLabels = {};
  for (const key of Object.keys(answers)) {
    const page = pages.get(key);
    const label = page ? visibleQuestionLabel(page) : "";
    if (label) snapshots[key] = label;
  }
  return snapshots;
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
 * customer wording: each answer is labelled with the question as the applicant
 * saw it. For new records, submission-time snapshots take priority; legacy
 * records fall back to the current funnel configuration.
 */
export function resolveApplicationAnswers(
  config: FunnelConfig | undefined,
  answers: ApplicationRecord["answers"],
  answerLabels?: ApplicationAnswerLabels,
  questionLabels?: ApplicationQuestionLabels,
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
        questionLabels?.[key]?.trim()
        || (page && visibleQuestionLabel(page))
        || (!isTechnicalAnswerKey(persistedLabel) && persistedLabel)
        || `Frage ${index + 1}`,
      values: values.map(value => snapshots?.[value] || optionLabels.get(value) || value),
    };
  });
}
