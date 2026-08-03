import "server-only";

import { randomUUID } from "node:crypto";
import {
  MetaCreativeImportError,
  importMetaCreativeImage,
} from "@/lib/creative-assets/meta-import";
import {
  assertValidatedImportedAsset,
  type AssetImportCommand,
  type AutomationScopeCommand,
  type BlueprintCommand,
  type BudgetCanaryApprovalCommand,
  type BudgetCanaryMaterializationCommand,
  type BrandCommand,
  type DomainCommand,
  type KillSwitchCommand,
  type LaunchApprovalCommand,
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

export async function setCustomerAutomationScope(
  customer: MetaCustomer,
  command: AutomationScopeCommand,
): Promise<{
  selectionId: string;
  affectedTargetCount: number;
  managedBudgetOwnerCount: number;
}> {
  if (command.status === "MANAGED") {
    requireWriteReadyCustomer(customer, "einen Automationsbereich freigibst");
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("set_meta_customer_automation_scope", {
    p_user_id: customer.userId,
    p_platform_account_id: customer.platformAccountId,
    p_selection_type: command.selectionType,
    p_selection_id: command.selectionId,
    p_status: command.status,
    p_reason: command.reason,
  });
  const row = Array.isArray(data) ? data[0] : null;
  const affectedTargetCount = Number(row?.affected_target_count);
  const managedBudgetOwnerCount = Number(row?.managed_budget_owner_count);

  if (
    error ||
    typeof row?.selection_id !== "string" ||
    !Number.isSafeInteger(affectedTargetCount) ||
    affectedTargetCount < 0 ||
    !Number.isSafeInteger(managedBudgetOwnerCount) ||
    managedBudgetOwnerCount < 0
  ) {
    rpcFailure("Der Automationsbereich");
  }

  return {
    selectionId: row.selection_id,
    affectedTargetCount,
    managedBudgetOwnerCount,
  };
}

type CustomerBudgetCanaryMaterializationResult = {
  outcome: "CREATED" | "EXISTING";
  planId: string;
  status: string;
};

function parseCustomerBudgetCanaryMaterializationResult(
  value: unknown,
): CustomerBudgetCanaryMaterializationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    rpcFailure("Die Budget-Canary-Vorbereitung");
  }
  const record = value as Record<string, unknown>;
  if (
    (record.outcome !== "CREATED" && record.outcome !== "EXISTING") ||
    typeof record.plan_id !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(record.plan_id) ||
    typeof record.status !== "string"
  ) {
    rpcFailure("Die Budget-Canary-Vorbereitung");
  }
  return {
    outcome: record.outcome,
    planId: record.plan_id,
    status: record.status,
  };
}

export async function materializeCustomerBudgetCanary(
  customer: MetaCustomer,
  command: BudgetCanaryMaterializationCommand,
): Promise<CustomerBudgetCanaryMaterializationResult> {
  requireWriteReadyCustomer(customer, "einen Budget-Canary vorbereitest");
  if (!customer.marketingSyncId) {
    serviceError(
      "fresh_sync_required",
      409,
      "Vor der Canary-Vorbereitung ist ein aktueller erfolgreicher Meta-Abruf erforderlich.",
    );
  }

  const leaseToken = await claimMetaReadOperation({
    platformAccountId: customer.platformAccountId,
    userId: customer.userId,
    ownerId: `customer-budget-canary:${randomUUID()}`,
  });
  if (!leaseToken) {
    serviceError(
      "read_snapshot_busy",
      409,
      "Ein Meta-Sync oder Planer-Lauf ist aktiv. Bitte versuche die Canary-Vorbereitung in wenigen Minuten erneut.",
    );
  }

  let result: CustomerBudgetCanaryMaterializationResult | null = null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc(
      "materialize_meta_customer_budget_canary_plan",
      {
        p_user_id: customer.userId,
        p_platform_account_id: customer.platformAccountId,
        p_read_lease_token: leaseToken,
        p_reason: command.reason,
        p_planned_at: new Date().toISOString(),
      },
    );
    if (error) {
      serviceError(
        "canary_materialization_not_ready",
        409,
        "Der Canary wurde nicht vorbereitet: Genau ein aktiver Budgetowner, Budget-only-Policy, FREEZE_WRITES, aktueller EUR-Snapshot, Caps und Cooldown müssen vollständig erfüllt sein.",
      );
    }
    result = parseCustomerBudgetCanaryMaterializationResult(data);
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
          "Der Canary wurde nicht vorbereitet, weil die sichere Read-Lease nicht freigegeben werden konnte.",
        );
      }
    }
  }

  if (!result) {
    rpcFailure("Die Budget-Canary-Vorbereitung");
  }
  return result;
}

export async function approveCustomerBudgetCanary(
  customer: MetaCustomer,
  command: BudgetCanaryApprovalCommand,
): Promise<{
  approvalId: string;
  planId: string;
  planStatus: "PENDING";
  executableAt: string;
  approvedAt: string;
}> {
  requireWriteReadyCustomer(customer, "einen Budget-Canary bestätigst");

  if (!customer.marketingSyncId) {
    serviceError(
      "fresh_sync_required",
      409,
      "Vor der Canary-Bestätigung ist ein aktueller erfolgreicher Meta-Abruf erforderlich.",
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("approve_meta_budget_canary_plan", {
    p_user_id: customer.userId,
    p_platform_account_id: customer.platformAccountId,
    p_plan_id: command.planId,
    p_expected_payload_hash: command.payloadHash,
    p_expected_before_minor: command.currentBudgetMinor,
    p_intended_after_minor: command.intendedBudgetMinor,
    p_reason: command.reason,
  });
  const row = Array.isArray(data) ? data[0] : null;

  if (error) {
    serviceError(
      "canary_not_ready",
      409,
      "Der Budget-Canary ist nicht mehr exakt ausführbar. Bitte Sicherheitsmodus, Policy, Auswahl und aktuellen Meta-Abruf erneut prüfen.",
    );
  }

  if (
    typeof row?.approval_id !== "string" ||
    row?.plan_id !== command.planId ||
    row?.plan_status !== "PENDING" ||
    typeof row?.executable_at !== "string" ||
    typeof row?.approved_at !== "string"
  ) {
    rpcFailure("Die Budget-Canary-Bestätigung");
  }

  return {
    approvalId: row.approval_id,
    planId: row.plan_id,
    planStatus: "PENDING",
    executableAt: row.executable_at,
    approvedAt: row.approved_at,
  };
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

type CustomerLaunchCommonResult = {
  outcome: "CREATED" | "EXISTING";
  planId: string;
  status: "HELD";
  payloadHash: string;
  objective: string;
  destinationUrl: string;
  targetStatus: "ACTIVE";
  campaignName: string;
  adSetName: string;
  creativeName: string;
  adName: string;
  brandAssetIds: string[];
  preparedAt: string;
};

export type CustomerLaunchResult = CustomerLaunchCommonResult &
  (
    | {
        budgetType: "DAILY";
        budgetOwnerType: "CAMPAIGN" | "AD_SET";
        dailyBudgetMinor: string;
      }
    | {
        budgetType: "LIFETIME";
        budgetOwnerType: "CAMPAIGN";
        lifetimeBudgetMinor: string;
        startTime: string;
        endTime: string;
      }
  );

function parseCustomerLaunchResult(value: unknown): CustomerLaunchResult {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    rpcFailure("Die Aktiv-Launch-Vorbereitung");
  }
  const record = raw as Record<string, unknown>;
  const budgetType = record.budget_type === "LIFETIME" ? "LIFETIME" : "DAILY";
  const brandAssetIds = Array.isArray(record.brand_asset_ids)
    ? record.brand_asset_ids.filter(
        (assetId): assetId is string =>
          typeof assetId === "string" && /^[0-9a-f-]{36}$/i.test(assetId),
      )
    : [];
  if (
    (record.budget_type !== undefined &&
      record.budget_type !== "DAILY" &&
      record.budget_type !== "LIFETIME") ||
    (record.outcome !== "CREATED" && record.outcome !== "EXISTING") ||
    typeof record.plan_id !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(record.plan_id) ||
    record.status !== "HELD" ||
    typeof record.payload_hash !== "string" ||
    !/^[0-9a-f]{64}$/.test(record.payload_hash) ||
    typeof record.objective !== "string" ||
    typeof record.destination_url !== "string" ||
    record.target_status !== "ACTIVE" ||
    (record.budget_owner_type !== "CAMPAIGN" &&
      record.budget_owner_type !== "AD_SET") ||
    typeof record.campaign_name !== "string" ||
    typeof record.ad_set_name !== "string" ||
    typeof record.creative_name !== "string" ||
    typeof record.ad_name !== "string" ||
    brandAssetIds.length < 1 ||
    typeof record.prepared_at !== "string"
  ) {
    rpcFailure("Die Aktiv-Launch-Vorbereitung");
  }
  const common: CustomerLaunchCommonResult = {
    outcome: record.outcome,
    planId: record.plan_id,
    status: "HELD",
    payloadHash: record.payload_hash,
    objective: record.objective,
    destinationUrl: record.destination_url,
    targetStatus: "ACTIVE",
    campaignName: record.campaign_name,
    adSetName: record.ad_set_name,
    creativeName: record.creative_name,
    adName: record.ad_name,
    brandAssetIds,
    preparedAt: record.prepared_at,
  };

  if (budgetType === "DAILY") {
    const dailyBudgetMinor = String(record.daily_budget_minor ?? "");
    if (!/^[1-9][0-9]*$/.test(dailyBudgetMinor)) {
      rpcFailure("Die Aktiv-Launch-Vorbereitung");
    }
    return {
      ...common,
      budgetType,
      budgetOwnerType: record.budget_owner_type,
      dailyBudgetMinor,
    };
  }

  const lifetimeBudgetMinor = String(record.lifetime_budget_minor ?? "");
  if (
    record.budget_owner_type !== "CAMPAIGN" ||
    !/^[1-9][0-9]*$/.test(lifetimeBudgetMinor) ||
    typeof record.start_time !== "string" ||
    typeof record.end_time !== "string" ||
    !Number.isFinite(Date.parse(record.start_time)) ||
    !Number.isFinite(Date.parse(record.end_time)) ||
    Date.parse(record.end_time) <= Date.parse(record.start_time)
  ) {
    rpcFailure("Die Aktiv-Launch-Vorbereitung");
  }
  return {
    ...common,
    budgetType,
    budgetOwnerType: "CAMPAIGN",
    lifetimeBudgetMinor,
    startTime: new Date(record.start_time).toISOString(),
    endTime: new Date(record.end_time).toISOString(),
  };
}

export async function materializeCustomerLaunch(
  customer: MetaCustomer,
  command: LaunchCommand,
): Promise<CustomerLaunchResult> {
  requireWriteReadyCustomer(customer, "einen Aktiv-Launch vorbereitest");
  if (!customer.marketingSyncId) {
    serviceError(
      "fresh_sync_required",
      409,
      "Vor der Aktiv-Launch-Vorbereitung ist ein aktueller erfolgreicher Meta-Abruf erforderlich.",
    );
  }

  const leaseToken = await claimMetaReadOperation({
    platformAccountId: customer.platformAccountId,
    userId: customer.userId,
    ownerId: `customer-launch-prepare:${randomUUID()}`,
  });
  if (!leaseToken) {
    serviceError(
      "read_snapshot_busy",
      409,
      "Ein Meta-Sync oder Planer-Lauf ist aktiv. Bitte versuche die Aktiv-Launch-Vorbereitung in wenigen Minuten erneut.",
    );
  }

  let result: CustomerLaunchResult | null = null;
  try {
    const admin = createAdminClient();
    const commonRpcArguments = {
      p_user_id: customer.userId,
      p_platform_account_id: customer.platformAccountId,
      p_read_lease_token: leaseToken,
      p_blueprint_id: command.blueprintId,
      p_brand_profile_id: command.brandProfileId,
      p_brand_asset_id: command.brandAssetId,
      p_allowed_domain_id: command.allowedDomainId,
      p_budget_owner_type: command.budgetOwnerType,
      p_launch_inputs: {
        ...command.launchInputs,
        preparation_reason: command.reason,
      },
      p_planned_at: new Date().toISOString(),
    };
    const { data, error } =
      command.budgetType === "DAILY"
        ? await admin.rpc("materialize_meta_customer_launch_plan", {
            ...commonRpcArguments,
            p_daily_budget_minor: command.dailyBudgetMinor,
          })
        : await admin.rpc("materialize_meta_customer_lifetime_launch_plan_v3", {
            ...commonRpcArguments,
            p_lifetime_budget_minor: command.lifetimeBudgetMinor,
            p_start_time: command.startTime,
            p_end_time: command.endTime,
          });
    if (error) {
      serviceError(
        "launch_preparation_not_ready",
        409,
        "Der Aktiv-Launch wurde nicht vorbereitet: FREEZE_WRITES, aktueller EUR-Snapshot, Launch-Policy, Budgetgrenzen, Domain, Brand und Creative müssen vollständig erfüllt sein.",
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
          "Der Aktiv-Launch wurde nicht vorbereitet, weil die sichere Read-Lease nicht freigegeben werden konnte.",
        );
      }
    }
  }

  if (!result) {
    rpcFailure("Die Aktiv-Launch-Vorbereitung");
  }
  return result;
}

export async function approveCustomerLaunch(
  customer: MetaCustomer,
  command: LaunchApprovalCommand,
): Promise<{
  approvalId: string;
  planId: string;
  planStatus: "PENDING";
  executableAt: string;
  approvedAt: string;
}> {
  requireWriteReadyCustomer(customer, "einen Aktiv-Launch freigibst");
  if (!customer.marketingSyncId) {
    serviceError(
      "fresh_sync_required",
      409,
      "Vor der Aktiv-Launch-Freigabe ist ein aktueller erfolgreicher Meta-Abruf erforderlich.",
    );
  }

  const admin = createAdminClient();
  const commonRpcArguments = {
    p_user_id: customer.userId,
    p_platform_account_id: customer.platformAccountId,
    p_plan_id: command.planId,
    p_expected_payload_hash: command.payloadHash,
    p_expected_objective: command.objective,
    p_expected_destination_url: command.destinationUrl,
    p_expected_target_status: command.targetStatus,
    p_expected_budget_owner_type: command.budgetOwnerType,
    p_expected_campaign_name: command.campaignName,
    p_expected_ad_set_name: command.adSetName,
    p_expected_creative_name: command.creativeName,
    p_expected_ad_name: command.adName,
    p_reason: command.reason,
  };
  const { data, error } =
    command.budgetType === "DAILY"
      ? await admin.rpc("approve_meta_launch_canary_plan", {
          ...commonRpcArguments,
          p_expected_daily_budget_minor: command.dailyBudgetMinor,
        })
      : await admin.rpc("approve_meta_lifetime_launch_canary_plan_v3", {
          ...commonRpcArguments,
          p_expected_lifetime_budget_minor: command.lifetimeBudgetMinor,
          p_expected_start_time: command.startTime,
          p_expected_end_time: command.endTime,
        });
  const row = Array.isArray(data) ? data[0] : null;

  if (error) {
    serviceError(
      "launch_approval_not_ready",
      409,
      "Der Aktiv-Launch ist nicht mehr exakt ausführbar. Bitte Plan, Fingerprint, FREEZE_WRITES, Policy und aktuellen Meta-Abruf erneut prüfen.",
    );
  }
  if (
    typeof row?.approval_id !== "string" ||
    row?.plan_id !== command.planId ||
    row?.plan_status !== "PENDING" ||
    typeof row?.executable_at !== "string" ||
    typeof row?.approved_at !== "string"
  ) {
    rpcFailure("Die Aktiv-Launch-Freigabe");
  }

  return {
    approvalId: row.approval_id,
    planId: row.plan_id,
    planStatus: "PENDING",
    executableAt: row.executable_at,
    approvedAt: row.approved_at,
  };
}
