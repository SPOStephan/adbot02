import type { MetaCustomer } from "@/lib/meta/customer-control-service";
import {
  type MetaCampaignDraftPayload,
} from "@/lib/meta/campaign-draft-types";
import { createAdminClient } from "@/lib/supabase/admin";

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
