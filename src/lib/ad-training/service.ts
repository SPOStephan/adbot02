import "server-only";

import { randomUUID } from "node:crypto";

import { fetchLandingPageContext } from "@/lib/ad-copy/page-context";
import { suggestAdCopyForDestination } from "@/lib/ad-copy/suggest";
import type { AdCopyObjective } from "@/lib/ad-copy/providers/types";
import type { AdIntelligencePlatform } from "@/lib/ad-intelligence/contract";
import { formatAdLearningPromptBlock } from "@/lib/ad-learning/context";
import { loadAdLearningContext } from "@/lib/ad-learning/retrieve";
import { generateTrainingAdImage, isTrainingImageGenerationConfigured } from "./image";
import type { TrainingInbox, TrainingRunView, TrainingVerdict } from "./types";

export class TrainingServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "TrainingServiceError";
    this.code = code;
    this.status = status;
  }
}

type RunRow = {
  id: string;
  landing_url: string;
  landing_hostname: string;
  landing_title: string;
  landing_excerpt: string;
  platform: string;
  objective: string;
  industry: string;
  headline: string;
  primary_text: string;
  description: string;
  image_asset_id: string | null;
  image_error: string | null;
  verdict: string | null;
  verdict_note: string;
  rated_at: string | null;
  created_at: string;
};

const SELECT =
  "id,landing_url,landing_hostname,landing_title,landing_excerpt,platform,objective,industry,headline,primary_text,description,image_asset_id,image_error,verdict,verdict_note,rated_at,created_at";

function isMissingTable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || /adbot_training_runs/i.test(error.message ?? "");
}

function view(row: RunRow): TrainingRunView {
  return {
    id: row.id,
    landingUrl: row.landing_url,
    landingHostname: row.landing_hostname,
    landingTitle: row.landing_title,
    landingExcerpt: row.landing_excerpt,
    platform: row.platform,
    objective: row.objective,
    industry: row.industry,
    headline: row.headline,
    primaryText: row.primary_text,
    description: row.description,
    imageAssetId: row.image_asset_id,
    imagePreviewUrl: row.image_asset_id
      ? `/api/media-library/preview?assetId=${encodeURIComponent(row.image_asset_id)}`
      : null,
    imageError: row.image_error,
    verdict: row.verdict === "keep" || row.verdict === "reject" ? row.verdict : null,
    verdictNote: row.verdict_note ?? "",
    ratedAt: row.rated_at,
    createdAt: row.created_at,
  };
}

function mapObjective(value: string): AdCopyObjective {
  if (value === "leads" || value === "OUTCOME_LEADS") return "OUTCOME_LEADS";
  return "OUTCOME_TRAFFIC";
}

function learningObjective(value: string): string {
  if (value === "OUTCOME_LEADS" || value === "leads") return "leads";
  if (value === "OUTCOME_SALES" || value === "sales") return "sales";
  if (value === "OUTCOME_AWARENESS" || value === "awareness") return "awareness";
  return "traffic";
}

export async function loadTrainingInbox(): Promise<TrainingInbox> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("adbot_training_runs")
    .select(SELECT)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) {
    if (isMissingTable(error)) {
      return {
        runs: [],
        ratedCount: 0,
        keepCount: 0,
        rejectCount: 0,
        migrationNeeded: true,
        imageGenerationConfigured: isTrainingImageGenerationConfigured(),
      };
    }
    throw new TrainingServiceError("load_failed", 500, "Trainingsläufe nicht ladbar.");
  }
  const runs = ((data ?? []) as RunRow[]).map(view);
  return {
    runs,
    ratedCount: runs.filter((item) => item.verdict).length,
    keepCount: runs.filter((item) => item.verdict === "keep").length,
    rejectCount: runs.filter((item) => item.verdict === "reject").length,
    migrationNeeded: false,
    imageGenerationConfigured: isTrainingImageGenerationConfigured(),
  };
}

export async function generateTrainingAd(input: {
  createdBy: string;
  landingUrl: string;
  platform?: string;
  objective?: string;
  industry?: string;
}): Promise<TrainingRunView> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const page = await fetchLandingPageContext(input.landingUrl);
  const platform = (input.platform ?? "meta").trim() || "meta";
  const objective = learningObjective(input.objective ?? "traffic");
  const industry = (input.industry ?? "").trim();
  let hostname = "";
  try {
    hostname = new URL(page.url).hostname.toLowerCase();
  } catch {
    hostname = "";
  }

  const learning = await loadAdLearningContext({
    userId: input.createdBy,
    platform,
    objective,
    industry,
    landingHostname: hostname,
    customerLimit: 0,
  }).catch(() => ({
    inspirationPatterns: [],
    customerSignals: [],
    trainingSignals: [],
  }));

  const copy = await suggestAdCopyForDestination({
    userId: input.createdBy,
    destinationUrl: page.url,
    objective: mapObjective(objective),
    platform: (["meta", "openai_ads", "google", "tiktok"].includes(platform)
      ? platform
      : "meta") as AdIntelligencePlatform,
    industry,
    skipCredits: true,
  });

  const runId = randomUUID();
  const imagePrompt = [
    "Photorealistic advertising image, no text, no logos, no watermark.",
    page.title ? `Subject: ${page.title}` : "",
    copy.suggestion.headline ? `Campaign idea: ${copy.suggestion.headline}` : "",
    page.description || page.excerpt
      ? `Context: ${(page.description || page.excerpt).slice(0, 280)}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  let imageAssetId: string | null = null;
  let imageError: string | null = null;
  try {
    const image = await generateTrainingAdImage({
      uploaderUserId: input.createdBy,
      prompt: imagePrompt,
      runId,
    });
    if ("brandAssetId" in image) imageAssetId = image.brandAssetId;
    else imageError = image.skipped;
  } catch (error) {
    imageError = error instanceof Error ? error.message : "Bildgenerierung fehlgeschlagen.";
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("adbot_training_runs")
    .insert({
      id: runId,
      created_by: input.createdBy,
      landing_url: page.url,
      landing_hostname: hostname,
      landing_title: page.title,
      landing_excerpt: (page.description || page.excerpt).slice(0, 1500),
      platform,
      objective,
      industry,
      headline: copy.suggestion.headline,
      primary_text: copy.suggestion.primaryText,
      description: copy.suggestion.description,
      image_asset_id: imageAssetId,
      image_error: imageError,
      learning_prompt: formatAdLearningPromptBlock(learning),
      copy_provider: copy.billing.providerKey,
      copy_model: copy.billing.model,
    })
    .select(SELECT)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) {
      throw new TrainingServiceError(
        "migration_needed",
        503,
        "Bitte zuerst die Migration adbot_training_runs ausführen.",
      );
    }
    throw new TrainingServiceError(
      "insert_failed",
      500,
      error.message || "Trainingslauf konnte nicht gespeichert werden.",
    );
  }
  if (!data) {
    throw new TrainingServiceError("insert_failed", 500, "Trainingslauf ohne Ergebnis.");
  }
  return view(data as RunRow);
}

export async function rateTrainingAd(input: {
  id: string;
  verdict: TrainingVerdict;
  note?: string;
}): Promise<TrainingRunView> {
  if (input.verdict !== "keep" && input.verdict !== "reject") {
    throw new TrainingServiceError("invalid_verdict", 400, "Bewertung muss gut oder schlecht sein.");
  }
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("adbot_training_runs")
    .update({
      verdict: input.verdict,
      verdict_note: (input.note ?? "").trim().slice(0, 500),
      rated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .select(SELECT)
    .maybeSingle();
  if (error || !data) {
    throw new TrainingServiceError("rate_failed", 404, "Trainingslauf nicht gefunden.");
  }
  return view(data as RunRow);
}
