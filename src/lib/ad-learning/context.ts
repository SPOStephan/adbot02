import {
  EMPTY_AD_LEARNING_CONTEXT,
  type AdLearningContext,
  type CustomerCreativeSignal,
  type InspirationCorpusBucket,
  type InspirationCorpusCensus,
  type InspirationPattern,
  type TrainingGroundSignal,
} from "./types";

export { EMPTY_AD_LEARNING_CONTEXT };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

export function isInspirationLearningEligible(input: {
  libraryScope: string;
  library: unknown;
  customerVisible: unknown;
  hookText: string;
  bodyText: string;
  whyItWorks: string;
  triggeringPrompts: string[];
}): boolean {
  if (input.libraryScope !== "INSPIRATION") return false;
  if (input.library !== "ad_example_library") return false;
  if (input.customerVisible === true) return false;
  return Boolean(
    input.hookText ||
      input.bodyText ||
      input.whyItWorks ||
      input.triggeringPrompts.length > 0,
  );
}

export function inspirationRowHasImage(input: {
  storagePath?: string | null;
  mimeType?: string | null;
  metadata?: unknown;
}): boolean {
  if (text(input.storagePath)) return true;
  if (text(input.mimeType).startsWith("image/")) return true;
  const metadata =
    input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? (input.metadata as Record<string, unknown>)
      : {};
  const example =
    metadata.ad_example &&
    typeof metadata.ad_example === "object" &&
    !Array.isArray(metadata.ad_example)
      ? (metadata.ad_example as Record<string, unknown>)
      : {};
  const external =
    metadata.external_source &&
    typeof metadata.external_source === "object" &&
    !Array.isArray(metadata.external_source)
      ? (metadata.external_source as Record<string, unknown>)
      : {};
  return Boolean(
    text(example.image_url) ||
      text(external.image_url) ||
      text(example.preview_url) ||
      text(external.source_image_url),
  );
}

function bumpCorpusBucket(
  map: Map<string, InspirationCorpusBucket>,
  name: string,
  input: { withText: boolean; hasImage: boolean },
) {
  const key = name.trim() || "(ohne Zuordnung)";
  const current = map.get(key) ?? {
    name: key,
    total: 0,
    withText: 0,
    imageAndText: 0,
  };
  current.total += 1;
  if (input.withText) current.withText += 1;
  if (input.withText && input.hasImage) current.imageAndText += 1;
  map.set(key, current);
}

function sortCorpusBuckets(
  map: Map<string, InspirationCorpusBucket>,
): InspirationCorpusBucket[] {
  return [...map.values()].sort((a, b) => {
    if (b.imageAndText !== a.imageAndText) return b.imageAndText - a.imageAndText;
    if (b.withText !== a.withText) return b.withText - a.withText;
    return b.total - a.total;
  });
}

export function summarizeInspirationCorpus(
  rows: Array<{
    pattern: InspirationPattern | null;
    hasImage: boolean;
    industry?: string;
    platform?: string;
    objective?: string;
  }>,
): InspirationCorpusCensus {
  const industries = new Map<string, InspirationCorpusBucket>();
  const platforms = new Map<string, InspirationCorpusBucket>();
  const objectives = new Map<string, InspirationCorpusBucket>();
  let learningEligible = 0;
  let imageAndText = 0;
  let textOnly = 0;
  let imageOnly = 0;
  let neither = 0;

  for (const row of rows) {
    const withText = Boolean(row.pattern);
    if (withText) learningEligible += 1;
    if (withText && row.hasImage) imageAndText += 1;
    else if (withText) textOnly += 1;
    else if (row.hasImage) imageOnly += 1;
    else neither += 1;

    const flags = { withText, hasImage: row.hasImage };
    bumpCorpusBucket(
      industries,
      row.pattern?.industry || row.industry || "",
      flags,
    );
    bumpCorpusBucket(
      platforms,
      row.pattern?.platform || row.platform || "",
      flags,
    );
    bumpCorpusBucket(
      objectives,
      row.pattern?.objective || row.objective || "",
      flags,
    );
  }

  return {
    scanned: rows.length,
    learningEligible,
    imageAndText,
    textOnly,
    imageOnly,
    neither,
    industries: sortCorpusBuckets(industries),
    platforms: sortCorpusBuckets(platforms),
    objectives: sortCorpusBuckets(objectives),
  };
}

export function scoreInspirationMatch(
  pattern: Pick<
    InspirationPattern,
    "platform" | "objective" | "industry" | "qualityRating"
  > & { tags?: string[] },
  query: { platform?: string; objective?: string; industry?: string; tags?: string[] },
): number {
  let score = Number.isFinite(pattern.qualityRating) ? pattern.qualityRating : 0;
  if (query.platform && pattern.platform === query.platform) score += 10;
  if (query.objective && pattern.objective === query.objective) score += 8;
  const industry = (query.industry ?? "").trim().toLowerCase();
  if (industry && pattern.industry.toLowerCase().includes(industry)) score += 5;
  const wanted = (query.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean);
  if (wanted.length > 0) {
    const have = new Set((pattern.tags ?? []).map((tag) => tag.trim().toLowerCase()));
    const hits = wanted.filter((tag) => have.has(tag)).length;
    if (hits > 0) score += Math.min(24, hits * 12);
    else score -= 6;
  }
  return score;
}

export function inspirationPatternFromMetadata(input: {
  brandAssetId: string;
  libraryScope: string;
  metadata: unknown;
}): InspirationPattern | null {
  const metadata =
    input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? (input.metadata as Record<string, unknown>)
      : {};
  const example =
    metadata.ad_example &&
    typeof metadata.ad_example === "object" &&
    !Array.isArray(metadata.ad_example)
      ? (metadata.ad_example as Record<string, unknown>)
      : {};
  const external =
    metadata.external_source &&
    typeof metadata.external_source === "object" &&
    !Array.isArray(metadata.external_source)
      ? (metadata.external_source as Record<string, unknown>)
      : {};
  const hookText = text(example.hook_text);
  const bodyText = text(example.body_text);
  const whyItWorks = text(example.why_it_works);
  const triggeringPrompts = stringArray(external.triggering_prompts);
  if (
    !isInspirationLearningEligible({
      libraryScope: input.libraryScope,
      library: metadata.library,
      customerVisible: external.customer_visible,
      hookText,
      bodyText,
      whyItWorks,
      triggeringPrompts,
    })
  ) {
    return null;
  }
  const quality = Number(example.quality_rating);
  const structure =
    example.structure && typeof example.structure === "object" && !Array.isArray(example.structure)
      ? (example.structure as Record<string, unknown>)
      : {};
  const slots = Array.isArray(structure.slots) ? structure.slots : [];
  return {
    brandAssetId: input.brandAssetId,
    platform: text(example.platform) || "other",
    objective: text(example.objective) || "other",
    industry: text(example.industry),
    hookText,
    bodyText,
    whyItWorks,
    evidenceLevel: text(example.evidence_level) || "visual_only",
    triggeringPrompts,
    qualityRating: Number.isFinite(quality) ? quality : 0,
    tags: stringArray(example.tags).map((tag) => tag.toLowerCase()),
    structureKind: text(structure.kind) || text(example.structure_kind),
    structureSlots: slots
      .slice(0, 12)
      .map((item) => {
        const row =
          item && typeof item === "object" && !Array.isArray(item)
            ? (item as Record<string, unknown>)
            : {};
        return {
          key: text(row.key).slice(0, 40),
          role: text(row.role).slice(0, 40),
          placement: text(row.placement).slice(0, 80),
          maxChars: Number.isFinite(Number(row.maxChars ?? row.max_chars))
            ? Math.max(0, Math.trunc(Number(row.maxChars ?? row.max_chars)))
            : 0,
          notes: text(row.notes).slice(0, 200),
        };
      })
      .filter((slot) => slot.key.length > 0),
  };
}

export function scoreTrainingGroundMatch(
  signal: Pick<
    TrainingGroundSignal,
    "platform" | "objective" | "industry" | "landingHostname" | "tags"
  >,
  query: {
    platform?: string;
    objective?: string;
    industry?: string;
    landingHostname?: string;
    tags?: string[];
  },
): number {
  let score = 1;
  if (query.platform && signal.platform === query.platform) score += 10;
  if (query.objective && signal.objective === query.objective) score += 8;
  const industry = (query.industry ?? "").trim().toLowerCase();
  if (industry && signal.industry.toLowerCase().includes(industry)) score += 5;
  const host = (query.landingHostname ?? "").trim().toLowerCase();
  if (host && signal.landingHostname.toLowerCase() === host) score += 12;
  const wanted = (query.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean);
  if (wanted.length > 0) {
    const have = new Set((signal.tags ?? []).map((tag) => tag.trim().toLowerCase()));
    const hits = wanted.filter((tag) => have.has(tag)).length;
    if (hits > 0) score += Math.min(24, hits * 12);
    else score -= 6;
  }
  return score;
}

export function formatAdLearningPromptBlock(context: AdLearningContext): string {
  const inspiration = context.inspirationPatterns.slice(0, 5);
  const signals = context.customerSignals.slice(0, 5);
  const training = (context.trainingSignals ?? []).slice(0, 6);
  if (inspiration.length < 1 && signals.length < 1 && training.length < 1) return "";

  const lines = [
    "LERNKONTEXT (intern, nicht ausgeben):",
    "Abstrahiere Muster. Kopiere keine fremden Texte, Marken oder Layouts.",
    "Sichtbare Fremdanzeigen sind kein Leistungsbeleg.",
  ];

  if (inspiration.length > 0) {
    lines.push("Referenzmuster aus der internen Werbebibliothek:");
    inspiration.forEach((item, index) => {
      const parts = [
        `${index + 1}. [${item.platform}/${item.objective}]`,
        item.hookText ? `Hook: ${item.hookText.slice(0, 180)}` : "",
        item.bodyText ? `Text: ${item.bodyText.slice(0, 280)}` : "",
        item.triggeringPrompts[0]
          ? `Trigger: ${item.triggeringPrompts.slice(0, 3).join(" · ").slice(0, 220)}`
          : "",
        item.tags?.length ? `Tags: ${item.tags.slice(0, 6).join(", ")}` : "",
        item.structureSlots?.length
          ? `Struktur: ${item.structureSlots
              .slice(0, 6)
              .map((slot) => `${slot.key}@${slot.placement || "frei"}`)
              .join("; ")}`
          : "",
        item.evidenceLevel === "first_party_performance" && item.whyItWorks
          ? `First-Party-Hinweis: ${item.whyItWorks.slice(0, 180)}`
          : "",
      ].filter(Boolean);
      lines.push(parts.join(" | "));
    });
  }

  const kept = training.filter((item) => item.verdict === "keep");
  const rejected = training.filter((item) => item.verdict === "reject");
  if (kept.length > 0) {
    lines.push("Adbot-Training: diese bewerteten Varianten waren gut — Muster behalten:");
    kept.forEach((item, index) => {
      lines.push(
        [
          `${index + 1}. [${item.platform}/${item.objective}]`,
          item.headline ? `Headline: ${item.headline.slice(0, 160)}` : "",
          item.primaryText ? `Text: ${item.primaryText.slice(0, 240)}` : "",
          item.note ? `Warum gut: ${item.note.slice(0, 160)}` : "",
        ]
          .filter(Boolean)
          .join(" | "),
      );
    });
  }
  if (rejected.length > 0) {
    lines.push("Adbot-Training: diese Varianten waren schlecht — so nicht:");
    rejected.forEach((item, index) => {
      lines.push(
        [
          `${index + 1}. [${item.platform}/${item.objective}]`,
          item.headline ? `Headline: ${item.headline.slice(0, 160)}` : "",
          item.primaryText ? `Text: ${item.primaryText.slice(0, 240)}` : "",
          item.note ? `Warum schlecht: ${item.note.slice(0, 160)}` : "",
        ]
          .filter(Boolean)
          .join(" | "),
      );
    });
  }

  if (signals.length > 0) {
    lines.push(
      "Eigene ausgelieferte Werbemittel dieses Kontos (First-Party, gewichtet):",
    );
    signals.forEach((item, index) => {
      const kind =
        item.trainingStatus === "performance_winner"
          ? "hat in den letzten Tagen relativ besser performt"
          : "vom Werbetreibenden als stark markiert";
      lines.push(`${index + 1}. ${item.label.slice(0, 120)} — ${kind}.`);
    });
  }

  return lines.join("\n");
}

export function mergeStyleReferenceIds(
  selected: readonly string[],
  winners: readonly string[],
  max: number,
): string[] {
  const limit = Math.max(0, Math.floor(max));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [...selected, ...winners]) {
    const key = String(id ?? "").trim().toLowerCase();
    if (!key || seen.has(key) || out.length >= limit) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

export function customerSignalFromAsset(input: {
  brandAssetId: string;
  libraryScope: string;
  userId: string;
  ownerUserId: string;
  trainingStatus: string;
  originalFilename?: string | null;
}): CustomerCreativeSignal | null {
  if (input.libraryScope !== "CUSTOMER") return null;
  if (input.ownerUserId !== input.userId) return null;
  if (
    input.trainingStatus !== "marked_good" &&
    input.trainingStatus !== "performance_winner"
  ) {
    return null;
  }
  return {
    brandAssetId: input.brandAssetId,
    trainingStatus: input.trainingStatus,
    label: (input.originalFilename || "Creative").slice(0, 120),
  };
}
