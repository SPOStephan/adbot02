import "server-only";

import { createHash } from "node:crypto";

import { fetchLandingPageContext } from "@/lib/ad-copy/page-context";
import {
  creativePromptFromCore,
  extractCampaignIdeaCore,
  writeCampaignCopyFromCore,
} from "@/lib/campaign-pipeline/extract";
import {
  ideaCoreHasSubstance,
  parseIdeaCore,
  parseRealizedCopy,
  type CampaignIdeaSourceType,
  type CampaignIdeaStatus,
  type CampaignIdeaView,
} from "@/lib/campaign-pipeline/idea-core";
import { generateLibraryCreativeNow } from "@/lib/creative-assets/library-generate";
import { CustomerControlInputError } from "@/lib/meta/customer-control-input";
import { CustomerControlServiceError } from "@/lib/meta/customer-control-service";
import { createAdminClient } from "@/lib/supabase/admin";

export type { CampaignIdeaView } from "@/lib/campaign-pipeline/idea-core";

type PipelineCustomer = {
  userId: string;
  platformAccountId: string;
};

function hashIdea(input: {
  sourceType: CampaignIdeaSourceType;
  sourceUrl: string | null;
  keywords: string | null;
  notes: string | null;
  screenshotAssetId: string | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl,
        keywords: input.keywords,
        notes: input.notes,
        screenshotAssetId: input.screenshotAssetId,
      }),
    )
    .digest("hex");
}

function firstRpcRow(data: unknown): Record<string, unknown> | null {
  const raw = Array.isArray(data) ? data[0] : data;
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function asStatus(value: unknown): CampaignIdeaStatus {
  const text = String(value ?? "");
  if (
    text === "QUEUED" ||
    text === "READY" ||
    text === "REALIZING" ||
    text === "REALIZED" ||
    text === "FAILED" ||
    text === "ARCHIVED"
  ) {
    return text;
  }
  throw new CustomerControlServiceError(
    "campaign_idea_status",
    500,
    "Unerwarteter Ideen-Status.",
  );
}

function asSourceType(value: unknown): CampaignIdeaSourceType {
  const text = String(value ?? "");
  if (text === "LINK" || text === "SCREENSHOT" || text === "KEYWORDS") {
    return text;
  }
  throw new CustomerControlServiceError(
    "campaign_idea_source",
    500,
    "Unerwarteter Ideen-Typ.",
  );
}

function mapIdeaRow(row: Record<string, unknown>): CampaignIdeaView {
  return {
    id: String(row.id),
    sourceType: asSourceType(row.source_type),
    status: asStatus(row.status),
    sourceUrl: row.source_url == null ? null : String(row.source_url),
    keywords: row.keywords == null ? null : String(row.keywords),
    notes: row.notes == null ? null : String(row.notes),
    screenshotAssetId:
      row.screenshot_asset_id == null ? null : String(row.screenshot_asset_id),
    extractedCore: parseIdeaCore(row.extracted_core),
    extractedAt: row.extracted_at == null ? null : String(row.extracted_at),
    lastError: row.last_error == null ? null : String(row.last_error),
    destinationUrl:
      row.destination_url == null ? null : String(row.destination_url),
    objective: row.objective == null ? null : String(row.objective),
    realizedCopy: parseRealizedCopy(row.realized_copy),
    realizedAssetId:
      row.realized_asset_id == null ? null : String(row.realized_asset_id),
    realizedAt: row.realized_at == null ? null : String(row.realized_at),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

const IDEA_SELECT =
  "id,source_type,status,source_url,keywords,notes,screenshot_asset_id,extracted_core,extracted_at,last_error,destination_url,objective,realized_copy,realized_asset_id,realized_at,created_at,updated_at";

async function loadIdea(
  customer: PipelineCustomer,
  ideaId: string,
): Promise<CampaignIdeaView> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("campaign_ideas")
    .select(IDEA_SELECT)
    .eq("id", ideaId)
    .eq("user_id", customer.userId)
    .eq("platform_account_id", customer.platformAccountId)
    .maybeSingle();
  if (error || !data) {
    throw new CustomerControlServiceError(
      "campaign_idea_not_found",
      404,
      "Die Kampagnen-Idee wurde nicht gefunden.",
    );
  }
  return mapIdeaRow(data as Record<string, unknown>);
}

async function loadScreenshotBytes(
  customer: PipelineCustomer,
  assetId: string,
): Promise<{ mimeType: "image/png" | "image/jpeg"; bytes: Uint8Array } | null> {
  const admin = createAdminClient();
  const { data: asset } = await admin
    .from("brand_assets")
    .select("id,user_id,library_scope,storage_bucket,storage_path,mime_type,status")
    .eq("id", assetId)
    .eq("user_id", customer.userId)
    .eq("library_scope", "CUSTOMER")
    .maybeSingle();
  if (!asset?.storage_bucket || !asset.storage_path || asset.status === "REVOKED") {
    return null;
  }
  const downloaded = await admin.storage
    .from(String(asset.storage_bucket))
    .download(String(asset.storage_path));
  if (downloaded.error || !downloaded.data) return null;
  const mime =
    asset.mime_type === "image/png" || asset.mime_type === "image/jpeg"
      ? asset.mime_type
      : "image/jpeg";
  return {
    mimeType: mime,
    bytes: new Uint8Array(await downloaded.data.arrayBuffer()),
  };
}

export async function createCampaignIdea(
  customer: PipelineCustomer,
  command: {
    sourceType: CampaignIdeaSourceType;
    sourceUrl: string | null;
    keywords: string | null;
    notes: string | null;
    screenshotAssetId: string | null;
    destinationUrl: string | null;
    objective: string | null;
  },
): Promise<{ idea: CampaignIdeaView; alreadyExisted: boolean }> {
  const admin = createAdminClient();
  const ideaHash = hashIdea(command);
  let destinationHostname: string | null = null;
  if (command.destinationUrl) {
    destinationHostname = new URL(command.destinationUrl).hostname.toLowerCase();
  }

  const { data, error } = await admin.rpc("put_campaign_idea", {
    p_user_id: customer.userId,
    p_platform_account_id: customer.platformAccountId,
    p_source_type: command.sourceType,
    p_idea_hash: ideaHash,
    p_source_url: command.sourceUrl,
    p_keywords: command.keywords,
    p_notes: command.notes,
    p_screenshot_asset_id: command.screenshotAssetId,
    p_destination_url: command.destinationUrl,
    p_destination_hostname: destinationHostname,
    p_objective: command.objective,
  });
  const row = firstRpcRow(data);
  if (error || !row || typeof row.idea_id !== "string") {
    throw new CustomerControlServiceError(
      "campaign_idea_save_failed",
      500,
      "Die Idee konnte nicht gespeichert werden.",
    );
  }

  const alreadyExisted = Boolean(row.already_existed);
  const ideaId = row.idea_id;
  if (!alreadyExisted || asStatus(row.status) === "QUEUED") {
    await analyzeCampaignIdea(customer, ideaId);
  }
  return { idea: await loadIdea(customer, ideaId), alreadyExisted };
}

export async function analyzeCampaignIdea(
  customer: PipelineCustomer,
  ideaId: string,
): Promise<CampaignIdeaView> {
  const idea = await loadIdea(customer, ideaId);
  if (idea.status === "ARCHIVED") {
    throw new CustomerControlInputError(
      "campaign_idea_archived",
      "Eine archivierte Idee kann nicht erneut analysiert werden.",
    );
  }

  let pageTitle = "";
  let pageDescription = "";
  let pageExcerpt = "";
  if (idea.sourceUrl) {
    try {
      const page = await fetchLandingPageContext(idea.sourceUrl);
      pageTitle = page.title;
      pageDescription = page.description;
      pageExcerpt = page.excerpt;
    } catch {
      // Competitor/ad-library pages often block fetch — still extract from URL + notes.
    }
  }

  const screenshot = idea.screenshotAssetId
    ? await loadScreenshotBytes(customer, idea.screenshotAssetId)
    : null;

  const core = await extractCampaignIdeaCore({
    sourceType: idea.sourceType,
    sourceUrl: idea.sourceUrl,
    keywords: idea.keywords,
    notes: idea.notes,
    pageTitle,
    pageDescription,
    pageExcerpt,
    screenshot: screenshot ?? undefined,
  });
  const ready = ideaCoreHasSubstance(core);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("set_campaign_idea_core", {
    p_user_id: customer.userId,
    p_platform_account_id: customer.platformAccountId,
    p_idea_id: ideaId,
    p_extracted_core: core,
    p_status: ready ? "READY" : "QUEUED",
    p_last_error: ready
      ? null
      : "Kern noch unscharf. Stichworte oder Ziel-URL ergänzen.",
  });
  if (error || data !== true) {
    throw new CustomerControlServiceError(
      "campaign_idea_analyze_failed",
      500,
      "Die Idee konnte nicht verstanden werden.",
    );
  }
  return loadIdea(customer, ideaId);
}

export async function realizeCampaignIdea(
  customer: PipelineCustomer,
  command: {
    ideaId: string;
    destinationUrl: string;
    objective: string;
    generateCreative: boolean;
  },
): Promise<{ idea: CampaignIdeaView; launchPath: string }> {
  const idea = await loadIdea(customer, command.ideaId);
  if (idea.status === "ARCHIVED") {
    throw new CustomerControlInputError(
      "campaign_idea_archived",
      "Eine archivierte Idee kann nicht umgesetzt werden.",
    );
  }
  if (idea.status === "QUEUED" || !ideaCoreHasSubstance(idea.extractedCore)) {
    await analyzeCampaignIdea(customer, command.ideaId);
  }

  const admin = createAdminClient();
  await admin.rpc("set_campaign_idea_status", {
    p_user_id: customer.userId,
    p_platform_account_id: customer.platformAccountId,
    p_idea_id: command.ideaId,
    p_status: "REALIZING",
  });

  let pageTitle = "";
  let pageDescription = "";
  try {
    const page = await fetchLandingPageContext(command.destinationUrl);
    pageTitle = page.title;
    pageDescription = page.description;
  } catch {
    // Copy can still be written from the extracted core.
  }

  const latest = await loadIdea(customer, command.ideaId);
  const copy = await writeCampaignCopyFromCore({
    core: latest.extractedCore,
    destinationUrl: command.destinationUrl,
    objective: command.objective,
    pageTitle,
    pageDescription,
  });

  let realizedAssetId: string | null = null;
  if (command.generateCreative) {
    try {
      const generated = await generateLibraryCreativeNow({
        userId: customer.userId,
        platformAccountId: customer.platformAccountId,
        connectedPlatforms: ["meta"],
        prompt: creativePromptFromCore(latest.extractedCore),
        tags: ["pipeline", "from-idea"],
      });
      if (
        generated.brandAssetId &&
        generated.brandAssetId !== latest.screenshotAssetId
      ) {
        realizedAssetId = generated.brandAssetId;
      }
    } catch {
      realizedAssetId = null;
    }
  }

  const hostname = new URL(command.destinationUrl).hostname.toLowerCase();
  const { data, error } = await admin.rpc("realize_campaign_idea", {
    p_user_id: customer.userId,
    p_platform_account_id: customer.platformAccountId,
    p_idea_id: command.ideaId,
    p_destination_url: command.destinationUrl,
    p_destination_hostname: hostname,
    p_objective: command.objective,
    p_realized_copy: copy,
    p_realized_asset_id: realizedAssetId,
    p_campaign_brief_id: null,
  });
  if (error || data !== true) {
    await admin.rpc("set_campaign_idea_status", {
      p_user_id: customer.userId,
      p_platform_account_id: customer.platformAccountId,
      p_idea_id: command.ideaId,
      p_status: "FAILED",
      p_last_error: "Umsetzung fehlgeschlagen. Bitte erneut versuchen.",
    });
    throw new CustomerControlServiceError(
      "campaign_idea_realize_failed",
      500,
      "Die Kampagne konnte aus der Idee nicht gebaut werden.",
    );
  }

  const realized = await loadIdea(customer, command.ideaId);
  const params = new URLSearchParams();
  params.set("ideaId", realized.id);
  if (realized.realizedAssetId) {
    params.set("assetId", realized.realizedAssetId);
  }
  return {
    idea: realized,
    launchPath: `/dashboard/traffic-launch?${params.toString()}`,
  };
}

export async function archiveCampaignIdea(
  customer: PipelineCustomer,
  ideaId: string,
): Promise<{ ideaId: string; archived: true }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("set_campaign_idea_status", {
    p_user_id: customer.userId,
    p_platform_account_id: customer.platformAccountId,
    p_idea_id: ideaId,
    p_status: "ARCHIVED",
  });
  if (error || data !== true) {
    throw new CustomerControlServiceError(
      "campaign_idea_not_found",
      404,
      "Die Idee wurde nicht gefunden oder ist bereits archiviert.",
    );
  }
  return { ideaId, archived: true };
}

export async function listCampaignIdeas(
  customer: PipelineCustomer,
): Promise<CampaignIdeaView[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("campaign_ideas")
    .select(IDEA_SELECT)
    .eq("user_id", customer.userId)
    .eq("platform_account_id", customer.platformAccountId)
    .neq("status", "ARCHIVED")
    .order("updated_at", { ascending: false })
    .limit(40);
  if (error) {
    throw new CustomerControlServiceError(
      "campaign_idea_list_failed",
      500,
      "Die Ideen-Pipeline konnte nicht geladen werden.",
    );
  }
  return (data ?? []).map((row) => mapIdeaRow(row as Record<string, unknown>));
}
