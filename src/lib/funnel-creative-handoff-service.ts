import "server-only";

import { suggestAdCopyForDestination } from "@/lib/ad-copy/suggest";
import {
  formatStructureForPrompt,
  resolveAdStructureTemplate,
} from "@/lib/ad-examples/structure";
import { loadAdLearningContext } from "@/lib/ad-learning/retrieve";
import { generateLibraryCreativeNow } from "@/lib/creative-assets/library-generate";
import { listConnectedPlatformsForUser } from "@/lib/creative-assets/library-customer";
import type { FunnelCreativeHandoffPayload } from "@/lib/funnel-creative-handoff";
import { createAdminClient } from "@/lib/supabase/admin";

export type FunnelCreativeHandoffResult = {
  status: "QUEUED" | "SUCCEEDED" | "SKIPPED" | "FAILED";
  jobId?: string;
  skipReason?: string;
};

export async function processFunnelCreativeHandoff(
  payload: FunnelCreativeHandoffPayload,
): Promise<FunnelCreativeHandoffResult> {
  const admin = createAdminClient();
  const tags = payload.tags.length > 0 ? payload.tags : ["jobs"];
  const { data: existing } = await admin
    .from("funnel_creative_handoffs")
    .select("id,status,job_id")
    .eq("funnel_id", payload.funnelId)
    .eq("destination_url", payload.destinationUrl)
    .maybeSingle();
  if (existing && (existing.status === "SUCCEEDED" || existing.status === "QUEUED")) {
    return {
      status: existing.status,
      jobId: typeof existing.job_id === "string" ? existing.job_id : undefined,
      skipReason: "already_processed",
    };
  }

  const row = {
    user_id: payload.sub,
    funnel_id: payload.funnelId,
    destination_url: payload.destinationUrl,
    title: payload.title,
    tags,
    job_title: payload.jobTitle,
    job_description: payload.jobDescription,
    status: "PENDING",
    updated_at: new Date().toISOString(),
  };
  const { data: inserted, error: insertError } = existing
    ? await admin
        .from("funnel_creative_handoffs")
        .update(row)
        .eq("id", existing.id)
        .select("id")
        .maybeSingle()
    : await admin.from("funnel_creative_handoffs").insert(row).select("id").maybeSingle();
  if (insertError || !inserted) {
    return { status: "SKIPPED", skipReason: insertError?.message || "handoff_table_missing" };
  }

  try {
    const platforms = await listConnectedPlatformsForUser(payload.sub);
    const { data: account } = await admin
      .from("platform_accounts")
      .select("id")
      .eq("user_id", payload.sub)
      .eq("platform", "meta")
      .is("revoked_at", null)
      .maybeSingle();
    const structure = resolveAdStructureTemplate({ kind: "job", tags });
    await loadAdLearningContext({
      userId: payload.sub,
      objective: "OUTCOME_LEADS",
      tags,
      landingHostname: new URL(payload.destinationUrl).hostname,
    }).catch(() => null);
    await suggestAdCopyForDestination({
      userId: payload.sub,
      destinationUrl: payload.destinationUrl,
      objective: "OUTCOME_LEADS",
      industry: tags.includes("jobs") ? "Recruiting" : "",
      offer: payload.jobTitle || payload.title,
    });
    const generated = await generateLibraryCreativeNow({
      userId: payload.sub,
      platformAccountId: account?.id ? String(account.id) : null,
      connectedPlatforms: platforms,
      tags,
      prompt: [
        "Photorealistic advertising image, no text, no logos, no watermark.",
        payload.jobTitle ? `Job: ${payload.jobTitle}` : `Funnel: ${payload.title}`,
        payload.jobDescription ? `Role: ${payload.jobDescription}` : "",
        formatStructureForPrompt(structure),
        `Destination: ${payload.destinationUrl}`,
      ]
        .filter(Boolean)
        .join(" "),
    });
    await admin
      .from("funnel_creative_handoffs")
      .update({
        status: "SUCCEEDED",
        job_id: generated.jobId,
        skip_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", inserted.id);
    return { status: "SUCCEEDED", jobId: generated.jobId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "handoff_failed";
    await admin
      .from("funnel_creative_handoffs")
      .update({
        status: "FAILED",
        skip_reason: message.slice(0, 400),
        updated_at: new Date().toISOString(),
      })
      .eq("id", inserted.id)
      .then(() => undefined, () => undefined);
    return { status: "FAILED", skipReason: message };
  }
}
