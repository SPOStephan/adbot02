import {
  CustomerControlServiceError,
  type MetaCustomer,
} from "@/lib/meta/customer-control-service";
import { normalizeMetaCampaignDraftPayload } from "@/lib/meta/campaign-draft";
import {
  draftPayloadFromLaunchPlan,
  duplicateDraftPayload,
  matchLaunchedDraft,
} from "@/lib/meta/campaign-draft-duplicate";
import {
  type MetaCampaignDraftPayload,
} from "@/lib/meta/campaign-draft-types";
import { createAdminClient } from "@/lib/supabase/admin";

export async function getMetaCampaignDraftDestination(
  customer: MetaCustomer,
  draftId: string,
): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("meta_campaign_drafts")
    .select("destination_url")
    .eq("id", draftId)
    .eq("user_id", customer.userId)
    .eq("platform_account_id", customer.platformAccountId)
    .eq("status", "DRAFT")
    .maybeSingle();
  if (error || typeof data?.destination_url !== "string") {
    throw new Error("Der Kampagnenentwurf wurde nicht gefunden.");
  }
  return data.destination_url;
}

export async function saveMetaCampaignDraft(
  customer: MetaCustomer,
  input: {
    draftId: string | null;
    revision: number;
    payload: MetaCampaignDraftPayload;
  },
): Promise<{ draftId: string; revision: number; savedAt: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("save_meta_campaign_draft", {
    p_user_id: customer.userId,
    p_platform_account_id: customer.platformAccountId,
    p_draft_id: input.draftId,
    p_payload: input.payload,
    p_revision: input.revision,
  });
  if (error) throw new Error(`Der Kampagnenentwurf konnte nicht gespeichert werden: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (
    !row ||
    typeof row.draft_id !== "string" ||
    !Number.isSafeInteger(Number(row.saved_revision)) ||
    typeof row.saved_at !== "string"
  ) {
    throw new Error("Der Kampagnenentwurf wurde nicht eindeutig bestätigt.");
  }
  return {
    draftId: row.draft_id,
    revision: Number(row.saved_revision),
    savedAt: row.saved_at,
  };
}

export async function setMetaCampaignDraftStatus(
  customer: MetaCustomer,
  input: { draftId: string; status: "ARCHIVED" | "LAUNCHED" },
): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("set_meta_campaign_draft_status", {
    p_user_id: customer.userId,
    p_platform_account_id: customer.platformAccountId,
    p_draft_id: input.draftId,
    p_status: input.status,
  });
  if (error || data !== true) {
    throw new Error(
      error
        ? `Der Entwurfsstatus konnte nicht gespeichert werden: ${error.message}`
        : "Der Kampagnenentwurf wurde nicht gefunden.",
    );
  }
}

function duplicateNotPossible(message: string): never {
  throw new CustomerControlServiceError("campaign_duplicate_unavailable", 409, message);
}

/**
 * "Als Vorlage duplizieren": creates a new DRAFT from an Adbot-launched Meta
 * campaign. Uses the launched draft when it can be matched, otherwise the
 * launch plan payload. Nothing is sent to Meta here; the copy starts through
 * the normal launch flow with all existing gates.
 */
export async function duplicateMetaCampaignAsDraft(
  customer: MetaCustomer,
  platformCampaignId: string,
): Promise<{ draftId: string; campaignName: string; source: "draft" | "plan" }> {
  const admin = createAdminClient();
  const { data: binding, error: bindingError } = await admin
    .from("remote_object_bindings")
    .select("plan_id")
    .eq("user_id", customer.userId)
    .eq("platform_account_id", customer.platformAccountId)
    .eq("object_type", "CAMPAIGN")
    .eq("remote_object_id", platformCampaignId)
    .maybeSingle();
  if (bindingError) throw new Error("Die Kampagne konnte nicht geladen werden.");
  if (typeof binding?.plan_id !== "string") {
    duplicateNotPossible(
      "Nur Kampagnen, die Adbot gestartet hat, können als Vorlage dupliziert werden.",
    );
  }

  const { data: plan, error: planError } = await admin
    .from("mutation_plans")
    .select("planned_payload,source_rule_key,action_type")
    .eq("id", binding.plan_id)
    .eq("user_id", customer.userId)
    .eq("platform_account_id", customer.platformAccountId)
    .maybeSingle();
  if (planError) throw new Error("Die Startdaten der Kampagne konnten nicht geladen werden.");
  if (
    !plan ||
    plan.source_rule_key !== "active-launch-chain" ||
    plan.action_type !== "LAUNCH_CHAIN"
  ) {
    duplicateNotPossible(
      "Diese Kampagne wurde nicht über den Adbot-Kampagnenstart angelegt und kann nicht als Vorlage dienen.",
    );
  }

  const { data: launchedDrafts, error: draftsError } = await admin
    .from("meta_campaign_drafts")
    .select("campaign_name,destination_url,payload")
    .eq("user_id", customer.userId)
    .eq("platform_account_id", customer.platformAccountId)
    .eq("status", "LAUNCHED")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (draftsError) throw new Error("Die gespeicherten Kampagnenentwürfe konnten nicht geladen werden.");

  let source: "draft" | "plan" = "plan";
  let sourcePayload: MetaCampaignDraftPayload | null = null;
  const matchedDraft = matchLaunchedDraft(plan.planned_payload, launchedDrafts ?? []);
  if (matchedDraft) {
    try {
      sourcePayload = normalizeMetaCampaignDraftPayload(matchedDraft.payload);
      source = "draft";
    } catch {
      sourcePayload = null;
    }
  }
  if (!sourcePayload) {
    const pixelId = (plan.planned_payload as { ad_set?: { promoted_object?: { pixel_id?: unknown } } } | null)
      ?.ad_set?.promoted_object?.pixel_id;
    let pixelRowId: string | null = null;
    if (typeof pixelId === "string" && /^\d{5,25}$/.test(pixelId)) {
      const { data: pixel } = await admin
        .from("meta_confirmed_pixels")
        .select("id")
        .eq("user_id", customer.userId)
        .eq("platform_account_id", customer.platformAccountId)
        .eq("pixel_id", pixelId)
        .is("revoked_at", null)
        .limit(1)
        .maybeSingle();
      pixelRowId = typeof pixel?.id === "string" ? pixel.id : null;
    }
    sourcePayload = draftPayloadFromLaunchPlan(plan.planned_payload, { pixelRowId });
  }
  if (!sourcePayload) {
    duplicateNotPossible("Die Startdaten dieser Kampagne reichen für eine Vorlage nicht aus.");
  }

  const payload = normalizeMetaCampaignDraftPayload(duplicateDraftPayload(sourcePayload));
  const saved = await saveMetaCampaignDraft(customer, {
    draftId: null,
    revision: 1,
    payload,
  });
  return { draftId: saved.draftId, campaignName: payload.campaignName, source };
}
