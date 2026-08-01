import "server-only";

import { randomUUID } from "node:crypto";
import {
  MetaCreativeImportError,
  importMetaCreativeImage,
} from "@/lib/creative-assets/meta-import";
import {
  assertValidatedImportedAsset,
  type AssetImportCommand,
  type BlueprintCommand,
  type BrandCommand,
  type DomainCommand,
  type KillSwitchCommand,
  type LaunchCommand,
  type PolicyCommand,
} from "@/lib/meta/customer-control-input";
import {
  claimMetaReadOperation,
  releaseMetaAccountOperation,
} from "@/lib/meta/planner";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type MetaCustomer = {
  userId: string;
  platformAccountId: string;
  accountName: string | null;
  currency: string | null;
  marketingSyncId: string | null;
  writeScopeGranted: boolean;
};

export class CustomerControlServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "CustomerControlServiceError";
    this.code = code;
    this.status = status;
  }
}

function serviceError(code: string, status: number, message: string): never {
  throw new CustomerControlServiceError(code, status, message);
}

export async function authenticateMetaCustomer(): Promise<MetaCustomer> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    serviceError("unauthorized", 401, "Bitte melde dich erneut an.");
  }

  const { data: account, error } = await supabase
    .from("platform_accounts")
    .select(
      "id,account_name,marketing_currency,meta_scopes,marketing_sync_id,marketing_sync_status,marketing_last_success_at",
    )
    .eq("user_id", user.id)
    .eq("platform", "meta")
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();

  if (error) {
    serviceError(
      "account_lookup_failed",
      500,
      "Das verbundene Meta-Konto konnte nicht sicher geprüft werden.",
    );
  }

  if (!account) {
    serviceError("meta_not_connected", 404, "Bitte verbinde zuerst ein Meta-Werbekonto.");
  }

  const lastSuccessAt =
    typeof account.marketing_last_success_at === "string"
      ? Date.parse(account.marketing_last_success_at)
      : Number.NaN;
  const now = Date.now();
  const marketingSyncId =
    account.marketing_sync_status === "success" &&
    typeof account.marketing_sync_id === "string" &&
    /^[0-9a-f-]{36}$/i.test(account.marketing_sync_id) &&
    Number.isFinite(lastSuccessAt) &&
    lastSuccessAt >= now - 2 * 60 * 60 * 1_000 &&
    lastSuccessAt <= now + 60 * 1_000
      ? account.marketing_sync_id
      : null;

  return {
    userId: user.id,
    platformAccountId: account.id,
    accountName: account.account_name,
    currency: account.marketing_currency,
    marketingSyncId,
    writeScopeGranted:
      Array.isArray(account.meta_scopes) && account.meta_scopes.includes("ads_management"),
  };
}

function rpcFailure(operation: string): never {
  serviceError(
    "control_command_failed",
    500,
    `${operation} konnte nicht sicher gespeichert werden. Es wurden keine unsicheren Änderungen ausgeführt.`,
  );
}

export async function saveCustomerPolicy(
  customer: MetaCustomer,
  command: PolicyCommand,
): Promise<{ policyId: string }> {
  if (command.enableAutomation && !customer.writeScopeGranted) {
    serviceError(
      "write_scope_required",
      409,
      "Bitte verbinde Meta erneut und bestätige den minimalen Schreibzugriff, bevor du die Autonomie aktivierst.",
    );
  }

  if (customer.currency !== "EUR") {
    serviceError(
      "eur_account_required",
      409,
      "Autonome Änderungen sind derzeit ausschließlich für Werbekonten in EUR freigegeben.",
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("put_meta_customer_policy_version", {
    p_user_id: customer.userId,
    p_platform_account_id: customer.platformAccountId,
    p_account_daily_hard_cap_minor: command.accountDailyHardCapMinor,
    p_default_campaign_daily_hard_cap_minor: command.campaignDailyHardCapMinor,
    p_allow_budget_changes: command.allowBudgetChanges,
    p_allow_status_changes: command.allowStatusChanges,
    p_allow_new_launches: command.allowNewLaunches,
    p_enable_automation: command.enableAutomation,
  });

  if (error || typeof data !== "string") {
    rpcFailure("Die Autonomie-Policy");
  }

  return { policyId: data };
}

export async function saveCustomerBrandProfile(
  customer: MetaCustomer,
  command: BrandCommand,
): Promise<{ brandProfileId: string }> {
  const admin = createAdminClient();
  const { data: assets, error: assetError } = await admin
    .from("meta_assets")
    .select("asset_type,meta_asset_id")
    .eq("user_id", customer.userId)
    .eq("platform_account_id", customer.platformAccountId)
    .in("asset_type", ["facebook_page", "instagram_account"])
    .order("created_at", { ascending: false });

  if (assetError) {
    serviceError(
      "brand_actor_lookup_failed",
      500,
      "Die verbundenen Brand-Assets konnten nicht sicher geprüft werden.",
    );
  }

  const facebookPageId = assets?.find(
    (asset) => asset.asset_type === "facebook_page",
  )?.meta_asset_id;
  const instagramActorId = assets?.find(
    (asset) => asset.asset_type === "instagram_account",
  )?.meta_asset_id;

  if (!facebookPageId || !/^\d{1,64}$/.test(facebookPageId)) {
    serviceError(
      "facebook_page_required",
      409,
      "Für aktive Ads muss eine gültige Facebook-Seite verbunden sein.",
    );
  }

  if (instagramActorId && !/^\d{1,64}$/.test(instagramActorId)) {
    serviceError(
      "invalid_instagram_actor",
      409,
      "Das verbundene Instagram-Profil ist nicht eindeutig und muss neu verbunden werden.",
    );
  }

  const { data, error } = await admin.rpc("put_brand_profile_version", {
    p_user_id: customer.userId,
    p_platform_account_id: customer.platformAccountId,
    p_display_name: command.displayName,
    p_brand_name: command.brandName,
    p_facebook_page_id: facebookPageId,
    p_instagram_actor_id: instagramActorId ?? null,
    p_guidelines: command.guidelines,
    p_forbidden_content: command.forbiddenContent,
    p_generation_defaults: command.generationDefaults,
    p_activate: true,
    p_generated_asset_approval_mode: command.generatedAssetApprovalMode,
  });

  if (error || typeof data !== "string") {
    rpcFailure("Das Brand-Profil");
  }

  return { brandProfileId: data };
}

export async function setCustomerKillSwitch(
  customer: MetaCustomer,
  command: KillSwitchCommand,
): Promise<{ eventId: string }> {
  if (command.mode === "ALLOW" && !customer.writeScopeGranted) {
    serviceError(
      "write_scope_required",
      409,
      "Bitte verbinde Meta erneut und bestätige den minimalen Schreibzugriff, bevor du Writes freigibst.",
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("set_meta_customer_kill_switch", {
    p_user_id: customer.userId,
    p_platform_account_id: customer.platformAccountId,
    p_mode: command.mode,
    p_reason: command.reason,
  });

  if (error || typeof data !== "string") {
    rpcFailure("Der Sicherheitsmodus");
  }

  return { eventId: data };
}

function requireWriteReadyCustomer(customer: MetaCustomer, operation: string): void {
  if (!customer.writeScopeGranted) {
    serviceError(
      "write_scope_required",
      409,
      `Bitte verbinde Meta erneut und bestätige den minimalen Schreibzugriff, bevor du ${operation}.`,
    );
  }
  if (customer.currency !== "EUR") {
    serviceError(
      "eur_account_required",
      409,
      "Autonome Änderungen sind derzeit ausschließlich für Werbekonten in EUR freigegeben.",
    );
  }
}

export async function applyCustomerDomainCommand(
  customer: MetaCustomer,
  command: DomainCommand,
): Promise<{ domainId: string; status: "PENDING" | "VERIFIED" }> {
  const admin = createAdminClient();
  if (command.action === "register") {
    const { data, error } = await admin.rpc("register_meta_allowed_domain", {
      p_user_id: customer.userId,
      p_platform_account_id: customer.platformAccountId,
      p_hostname: command.hostname,
      p_registrable_domain: command.registrableDomain,
      p_verification_method: command.verificationMethod,
      p_verification_evidence: command.verificationEvidence,
    });
    if (error || typeof data !== "string") {
      rpcFailure("Die Domain-Registrierung");
    }
    return { domainId: data, status: "PENDING" };
  }

  requireWriteReadyCustomer(customer, "eine Domain aktiv bestätigst");
  const { data, error } = await admin.rpc("confirm_meta_allowed_domain", {
    p_user_id: customer.userId,
    p_platform_account_id: customer.platformAccountId,
    p_domain_id: command.domainId,
  });
  if (error || typeof data !== "string") {
    rpcFailure("Die Domain-Bestätigung");
  }
  return { domainId: data, status: "VERIFIED" };
}

export async function applyCustomerBlueprintCommand(
  customer: MetaCustomer,
  command: BlueprintCommand,
): Promise<{ blueprintId: string; status: "DRAFT" | "ACTIVE" }> {
  const admin = createAdminClient();
  if (command.action === "save") {
    const { data, error } = await admin.rpc("put_meta_objective_blueprint", {
      p_user_id: customer.userId,
      p_platform_account_id: customer.platformAccountId,
      p_objective: command.objective,
      p_name: command.name,
      p_payload_template: command.payloadTemplate,
      p_required_inputs: command.requiredInputs,
    });
    if (error || typeof data !== "string") {
      rpcFailure("Der Objective-Blueprint");
    }
    return { blueprintId: data, status: "DRAFT" };
  }

  requireWriteReadyCustomer(customer, "einen Objective-Blueprint aktivierst");
  const { data, error } = await admin.rpc("activate_meta_objective_blueprint", {
    p_user_id: customer.userId,
    p_platform_account_id: customer.platformAccountId,
    p_blueprint_id: command.blueprintId,
  });
  if (error || typeof data !== "string") {
    rpcFailure("Die Blueprint-Aktivierung");
  }
  return { blueprintId: data, status: "ACTIVE" };
}

type SyncedCreativeContent = {
  image_hash?: unknown;
  image_url?: unknown;
  thumbnail_url?: unknown;
};

function syncedCreativeImageSource(content: unknown): {
  imageUrl: string;
  metaImageHash: string | null;
  sourceKind: "IMAGE_URL" | "THUMBNAIL_URL";
} {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    serviceError(
      "creative_image_unavailable",
      409,
      "Das gewählte Meta-Creative enthält kein importierbares Bild.",
    );
  }
  const record = content as SyncedCreativeContent;
  const imageUrl = typeof record.image_url === "string" ? record.image_url : null;
  const thumbnailUrl =
    typeof record.thumbnail_url === "string" ? record.thumbnail_url : null;
  const metaImageHash =
    typeof record.image_hash === "string" &&
    /^[A-Fa-f0-9]{16,128}$/.test(record.image_hash)
      ? record.image_hash.toLowerCase()
      : null;
  if (imageUrl) {
    return { imageUrl, metaImageHash, sourceKind: "IMAGE_URL" };
  }
  if (thumbnailUrl) {
    return { imageUrl: thumbnailUrl, metaImageHash, sourceKind: "THUMBNAIL_URL" };
  }
  serviceError(
    "creative_image_unavailable",
    409,
    "Das gewählte Meta-Creative enthält kein importierbares Bild.",
  );
}

export async function importCustomerBrandAsset(
  customer: MetaCustomer,
  command: AssetImportCommand,
): Promise<{ brandAssetId: string }> {
  requireWriteReadyCustomer(customer, "ein bestehendes Meta-Creative importierst");
  if (!customer.marketingSyncId) {
    serviceError(
      "fresh_marketing_sync_required",
      409,
      "Bitte aktualisiere zuerst die Meta-Daten; der Creative-Import benötigt einen frischen vollständigen Sync.",
    );
  }
  const admin = createAdminClient();
  const { data: creative, error: creativeError } = await admin
    .from("creatives")
    .select("platform_creative_id,content")
    .eq("user_id", customer.userId)
    .eq("platform_account_id", customer.platformAccountId)
    .eq("platform_creative_id", command.sourceCreativeId)
    .eq("source", "meta")
    .eq("is_current", true)
    .eq("last_seen_sync_id", customer.marketingSyncId)
    .maybeSingle();

  if (creativeError) {
    serviceError(
      "creative_lookup_failed",
      500,
      "Das gewählte Meta-Creative konnte nicht sicher geprüft werden.",
    );
  }
  if (!creative) {
    serviceError(
      "creative_not_found",
      404,
      "Das gewählte Meta-Creative gehört nicht zum verbundenen Werbekonto.",
    );
  }

  const source = syncedCreativeImageSource(creative.content);
  let imported;
  try {
    imported = await importMetaCreativeImage({
      userId: customer.userId,
      platformAccountId: customer.platformAccountId,
      creativeId: creative.platform_creative_id,
      imageUrl: source.imageUrl,
    });
  } catch (error) {
    if (error instanceof MetaCreativeImportError) {
      serviceError(error.code, 409, error.message);
    }
    serviceError(
      "creative_import_failed",
      500,
      "Das Meta-Creative konnte nicht sicher importiert werden.",
    );
  }

  const validated = assertValidatedImportedAsset({
    sha256: imported.sha256,
    mimeType: imported.mimeType,
    byteSize: imported.byteSize,
    width: imported.width,
    height: imported.height,
    metaImageHash: source.metaImageHash,
  });
  const { data, error } = await admin.rpc(
    "import_meta_brand_asset_from_creative",
    {
      p_user_id: customer.userId,
      p_platform_account_id: customer.platformAccountId,
      p_brand_profile_id: command.brandProfileId,
      p_source_meta_asset_id: command.sourceCreativeId,
      p_source_marketing_sync_id: customer.marketingSyncId,
      p_storage_bucket: imported.storageBucket,
      p_storage_path: imported.storagePath,
      p_original_filename: imported.originalFilename,
      p_sha256: validated.sha256,
      p_mime_type: validated.mimeType,
      p_byte_size: validated.byteSize,
      p_width: validated.width,
      p_height: validated.height,
      p_meta_image_hash: validated.metaImageHash,
      p_metadata: {
        contract_version: 1,
        source_kind: source.sourceKind,
        source_meta_creative_id: command.sourceCreativeId,
        imported_by: "customer-control-service",
      },
    },
  );
  if (error || typeof data !== "string") {
    rpcFailure("Der Import des Meta-Creatives");
  }
  return { brandAssetId: data };
}

type CustomerLaunchResult = {
  outcome: "CREATED" | "EXISTING";
  planId: string;
  status: string;
};

function parseCustomerLaunchResult(value: unknown): CustomerLaunchResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    rpcFailure("Der sichere Launch-Plan");
  }
  const record = value as Record<string, unknown>;
  if (
    (record.outcome !== "CREATED" && record.outcome !== "EXISTING") ||
    typeof record.plan_id !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(record.plan_id)
  ) {
    rpcFailure("Der sichere Launch-Plan");
  }
  return {
    outcome: record.outcome,
    planId: record.plan_id,
    status:
      typeof record.status === "string"
        ? record.status
        : record.outcome === "CREATED"
          ? "PENDING"
          : "UNKNOWN",
  };
}

export async function materializeCustomerLaunch(
  customer: MetaCustomer,
  command: LaunchCommand,
): Promise<CustomerLaunchResult> {
  requireWriteReadyCustomer(customer, "einen aktiven Launch autorisierst");
  const leaseToken = await claimMetaReadOperation({
    platformAccountId: customer.platformAccountId,
    userId: customer.userId,
    ownerId: `customer-launch:${randomUUID()}`,
  });
  if (!leaseToken) {
    serviceError(
      "read_snapshot_busy",
      409,
      "Ein Meta-Sync oder Planer-Lauf ist aktiv. Bitte versuche den Launch in wenigen Minuten erneut.",
    );
  }

  let result: CustomerLaunchResult | null = null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc(
      "materialize_meta_customer_launch_plan",
      {
        p_user_id: customer.userId,
        p_platform_account_id: customer.platformAccountId,
        p_read_lease_token: leaseToken,
        p_blueprint_id: command.blueprintId,
        p_brand_profile_id: command.brandProfileId,
        p_brand_asset_id: command.brandAssetId,
        p_allowed_domain_id: command.allowedDomainId,
        p_budget_owner_type: command.budgetOwnerType,
        p_daily_budget_minor: command.dailyBudgetMinor,
        p_launch_inputs: command.launchInputs,
        p_planned_at: new Date().toISOString(),
      },
    );
    if (error) {
      serviceError(
        "launch_readiness_failed",
        409,
        "Der Launch wurde nicht geplant: Policy, ALLOW, aktueller EUR-Snapshot, Budgetgrenzen oder Readiness-Gates sind noch nicht vollständig erfüllt.",
      );
    }
    result = parseCustomerLaunchResult(data);
  } finally {
    try {
      await releaseMetaAccountOperation({
        platformAccountId: customer.platformAccountId,
        userId: customer.userId,
        leaseToken,
      });
    } catch {
      if (!result) {
        serviceError(
          "read_lease_release_failed",
          500,
          "Der Launch wurde nicht ausgeführt, weil die sichere Read-Lease nicht freigegeben werden konnte.",
        );
      }
    }
  }

  if (!result) {
    rpcFailure("Der sichere Launch-Plan");
  }
  return result;
}
