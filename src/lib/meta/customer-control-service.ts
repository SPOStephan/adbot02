import "server-only";

import { createHash, randomUUID } from "node:crypto";
import {
  MetaCreativeImportError,
  importMetaCreativeImage,
} from "@/lib/creative-assets/meta-import";
import {
  assertValidatedImportedAsset,
  type AssetImportCommand,
  type AutomationScopeCommand,
  type BlueprintCommand,
  type BoostOverrideCommand,
  type BoostSettingsCommand,
  type BudgetCanaryApprovalCommand,
  type BudgetCanaryMaterializationCommand,
  type BrandCommand,
  type CampaignBriefArchiveCommand,
  type CampaignBriefCommand,
  type DomainCommand,
  type KillSwitchCommand,
  type LaunchApprovalCommand,
  type LaunchCommand,
  type PixelCommand,
  type OrganicBoostApprovalCommand,
  type OrganicBoostPrepareCommand,
  type PolicyCommand,
} from "@/lib/meta/customer-control-input";
import { drainOrganicBoostExecutionsForAccount } from "@/lib/meta/organic-boost-execute";
import { planAndDrainOrganicBoostForAccount } from "@/lib/meta/organic-boost-ensure";
import { runOrganicBoostPlannerForAccount } from "@/lib/meta/organic-boost-runner";
import {
  claimMetaReadOperation,
  releaseMetaAccountOperation,
  type MetaOrganicBoostPlannerResult,
} from "@/lib/meta/planner";
import { ensureLaunchMarketingReady } from "@/lib/meta/launch-marketing-ensure";
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

function rpcFailure(operation: string, detail?: string | null): never {
  const trimmed = detail?.trim();
  serviceError(
    "control_command_failed",
    500,
    trimmed
      ? `${operation} konnte nicht sicher gespeichert werden. Es wurden keine unsicheren Änderungen ausgeführt. Details: ${trimmed}`
      : `${operation} konnte nicht sicher gespeichert werden. Es wurden keine unsicheren Änderungen ausgeführt.`,
  );
}

function firstRpcRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    const row = data[0];
    return row && typeof row === "object" && !Array.isArray(row)
      ? (row as Record<string, unknown>)
      : null;
  }

  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }

  return null;
}

function rpcNonNegativeInt(
  value: unknown,
): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

async function tryRunOrganicBoostPlanner(input: {
  customer: MetaCustomer;
  ownerPrefix: string;
}): Promise<MetaOrganicBoostPlannerResult | null> {
  try {
    return await runOrganicBoostPlannerForAccount({
      platformAccountId: input.customer.platformAccountId,
      userId: input.customer.userId,
      ownerPrefix: input.ownerPrefix,
    });
  } catch (error) {
    return {
      status: "PLANNER_RPC_FAILED",
      plansCreated: 0,
      plansExisting: 0,
      candidatesSkipped: 0,
      candidatesFailed: 0,
      candidatesConsidered: 0,
      lastError:
        error instanceof Error
          ? error.message
          : "organic_boost_planner_exception",
    };
  }
}

async function countPendingOrganicBoostPlans(input: {
  userId: string;
  platformAccountId: string;
}): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("mutation_plans")
    .select("id", { count: "exact", head: true })
    .eq("user_id", input.userId)
    .eq("platform_account_id", input.platformAccountId)
    .eq("source_rule_key", "organic-boost")
    .eq("action_type", "LAUNCH_CHAIN")
    .in("status", ["PENDING", "RETRYABLE", "CLAIMED", "EXECUTING", "RECONCILING"]);
  if (error || typeof count !== "number") {
    return 0;
  }
  return count;
}

/** Revive soft-blocked/superseded plans, then push Meta writes immediately. */
async function reviveAndDrainOrganicBoost(input: {
  customer: MetaCustomer;
  organicBoost: MetaOrganicBoostPlannerResult | null;
}): Promise<MetaOrganicBoostPlannerResult | null> {
  const admin = createAdminClient();
  try {
    await admin.rpc("rebind_meta_organic_boost_plans_to_current_policy", {
      p_user_id: input.customer.userId,
      p_platform_account_id: input.customer.platformAccountId,
    });
  } catch {
    // Function may be absent before migration; prepare/drain still helps.
  }

  try {
    await admin.rpc("revive_meta_organic_boost_superseded_plans", {
      p_user_id: input.customer.userId,
      p_platform_account_id: input.customer.platformAccountId,
    });
  } catch {
    // Function may be absent before migration; drain still helps claimable plans.
  }

  const pendingPlans = await countPendingOrganicBoostPlans({
    userId: input.customer.userId,
    platformAccountId: input.customer.platformAccountId,
  });

  let executorRuns = 0;
  let executorSucceeded = 0;
  let executorFailed = 0;
  let executorLastOutcome: string | null = null;
  let executorLastError: string | null = null;
  if (pendingPlans > 0) {
    try {
      const drain = await drainOrganicBoostExecutionsForAccount({
        userId: input.customer.userId,
        platformAccountId: input.customer.platformAccountId,
        maxRuns: Math.min(8, Math.max(1, pendingPlans)),
      });
      executorRuns = drain.runs;
      executorSucceeded = drain.succeeded;
      executorFailed = drain.failed;
      executorLastOutcome = drain.lastOutcome;
      // prepareDetail with due=0 is diagnostic, not a Meta write failure.
      executorLastError = drain.lastError;
    } catch (error) {
      executorLastError =
        error instanceof Error
          ? error.message
          : "organic_boost_drain_exception";
    }
  }

  const base = input.organicBoost ?? {
    status: pendingPlans > 0 ? "PLANNED" : "NO_ELIGIBLE_CANDIDATES",
    plansCreated: 0,
    plansExisting: pendingPlans,
    candidatesSkipped: 0,
    candidatesFailed: 0,
    candidatesConsidered: 0,
    lastError: null,
  };

  // Planner reports NO_ELIGIBLE when candidates are already linked — surface queues.
  const status =
    base.status === "NO_ELIGIBLE_CANDIDATES" && pendingPlans > 0
      ? "PLANNED"
      : base.status;

  return {
    ...base,
    status,
    plansExisting: Math.max(base.plansExisting, pendingPlans),
    pendingPlans,
    executorRuns,
    executorSucceeded,
    executorFailed,
    executorLastOutcome,
    executorLastError,
  };
}

export async function saveCustomerPolicy(
  customer: MetaCustomer,
  command: PolicyCommand,
): Promise<{
  policyId: string;
  managedBudgetOwnerCount: number;
  organicBoost: MetaOrganicBoostPlannerResult | null;
}> {
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
  const { data, error } = await admin.rpc("put_meta_customer_budget_autonomy_policy", {
    p_user_id: customer.userId,
    p_platform_account_id: customer.platformAccountId,
    p_account_daily_hard_cap_minor: command.accountDailyHardCapMinor,
    p_default_campaign_daily_hard_cap_minor: command.campaignDailyHardCapMinor,
    p_allow_budget_changes: command.allowBudgetChanges,
    p_allow_status_changes: command.allowStatusChanges,
    p_allow_new_launches: command.allowNewLaunches,
    p_enable_automation: command.enableAutomation,
  });

  const result = firstRpcRow(data);
  const managedBudgetOwnerCount = rpcNonNegativeInt(
    result?.managed_budget_owner_count,
  );
  if (
    error ||
    !result ||
    typeof result.policy_id !== "string" ||
    managedBudgetOwnerCount === null
  ) {
    rpcFailure(
      "Die Autonomie-Policy",
      error?.message ??
        (result
          ? "Unerwartete Antwort vom Policy-RPC."
          : "Leere Antwort vom Policy-RPC."),
    );
  }

  // Autonomie + Launches = Writes freigeben + Beitrag-Push anstoßen.
  // Kein zweiter Klick auf Sicherheitsschranke nötig.
  let organicBoost: MetaOrganicBoostPlannerResult | null = null;
  if (
    command.enableAutomation &&
    command.allowNewLaunches &&
    command.allowStatusChanges
  ) {
    organicBoost = await tryRunOrganicBoostPlanner({
      customer,
      ownerPrefix: "organic-boost-policy",
    });
    organicBoost = await reviveAndDrainOrganicBoost({
      customer,
      organicBoost,
    });
  }

  return {
    policyId: result.policy_id as string,
    managedBudgetOwnerCount,
    organicBoost,
  };
}

export async function saveCustomerBrandProfile(
  customer: MetaCustomer,
  command: BrandCommand,
): Promise<{ brandProfileId: string }> {
  const admin = createAdminClient();
  const [
    { data: assets, error: assetError },
    { data: account, error: accountError },
  ] = await Promise.all([
    admin
      .from("meta_assets")
      .select("asset_type,meta_asset_id")
      .eq("user_id", customer.userId)
      .eq("platform_account_id", customer.platformAccountId)
      .in("asset_type", ["facebook_page", "instagram_account"])
      .order("created_at", { ascending: false }),
    admin
      .from("platform_accounts")
      .select("instagram_account_ids")
      .eq("id", customer.platformAccountId)
      .eq("user_id", customer.userId)
      .eq("platform", "meta")
      .is("revoked_at", null)
      .maybeSingle(),
  ]);

  if (assetError || accountError || !account) {
    serviceError(
      "brand_actor_lookup_failed",
      500,
      "Die verbundenen Brand-Assets konnten nicht sicher geprüft werden.",
    );
  }

  const selectedInstagramIds = new Set(
    Array.isArray(account.instagram_account_ids)
      ? account.instagram_account_ids.filter(
          (id): id is string =>
            typeof id === "string" && /^[0-9]{1,64}$/.test(id),
        )
      : [],
  );
  const facebookPageId = assets?.find(
    (asset) => asset.asset_type === "facebook_page",
  )?.meta_asset_id;
  const instagramActorId = assets?.find(
    (asset) =>
      asset.asset_type === "instagram_account" &&
      selectedInstagramIds.has(asset.meta_asset_id),
  )?.meta_asset_id;

  if (!facebookPageId || !/^\d{1,64}$/.test(facebookPageId)) {
    serviceError(
      "facebook_page_required",
      409,
      "Für aktive Ads muss eine gültige Facebook-Seite verbunden sein.",
    );
  }

  if (!instagramActorId || !/^\d{1,64}$/.test(instagramActorId)) {
    serviceError(
      "invalid_instagram_actor",
      409,
      "Bitte wähle zuerst ein gültiges Instagram-Profil für Adbot aus.",
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
): Promise<{
  eventId: string;
  organicBoost: MetaOrganicBoostPlannerResult | null;
}> {
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

  let organicBoost: MetaOrganicBoostPlannerResult | null = null;
  if (command.mode === "ALLOW") {
    organicBoost = await tryRunOrganicBoostPlanner({
      customer,
      ownerPrefix: "organic-boost-kill-switch",
    });
    organicBoost = await reviveAndDrainOrganicBoost({
      customer,
      organicBoost,
    });
  }

  return { eventId: data, organicBoost };
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

export async function applyCustomerPixelCommand(
  customer: MetaCustomer,
  command: PixelCommand,
): Promise<{
  pixelRowId: string;
  status: "CONFIRMED" | "REVOKED";
  pixelId?: string;
  customEventType?: string;
}> {
  const admin = createAdminClient();
  if (command.action === "confirm") {
    const { data, error } = await admin.rpc("confirm_meta_pixel", {
      p_user_id: customer.userId,
      p_platform_account_id: customer.platformAccountId,
      p_pixel_id: command.pixelId,
      p_label: command.label,
      p_custom_event_type: command.customEventType,
    });
    if (error || typeof data !== "string") {
      rpcFailure("Die Pixel-Bestätigung");
    }
    return {
      pixelRowId: data,
      status: "CONFIRMED",
      pixelId: command.pixelId,
      customEventType: command.customEventType,
    };
  }

  const { data, error } = await admin.rpc("revoke_meta_confirmed_pixel", {
    p_user_id: customer.userId,
    p_platform_account_id: customer.platformAccountId,
    p_pixel_row_id: command.pixelRowId,
  });
  if (error || typeof data !== "string") {
    rpcFailure("Das Zurückziehen der Pixel-Bindung");
  }
  return { pixelRowId: data, status: "REVOKED" };
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

/**
 * Launch prepare always ensures a fresh EUR marketing snapshot (incl. timezone).
 * Runs a dedicated Meta Abruf automatically — no separate customer chore.
 */
async function refreshCustomerMarketingForLaunch(
  customer: MetaCustomer,
): Promise<MetaCustomer> {
  const ensured = await ensureLaunchMarketingReady(customer);
  if (!ensured.ok) {
    serviceError("fresh_sync_required", 409, ensured.message);
  }
  return {
    ...customer,
    marketingSyncId: ensured.marketingSyncId,
  };
}

function launchPreparationFailureMessage(error: unknown): string {
  const record =
    error && typeof error === "object"
      ? (error as { message?: unknown; details?: unknown; hint?: unknown })
      : null;
  const raw = [record?.message, record?.details, record?.hint]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" | ");

  const rules: Array<[RegExp, string]> = [
    [
      /FREEZE_WRITES/i,
      "Die kurze Schreibpause für die Vorbereitung fehlt noch. Bitte erneut „Kampagne vorbereiten“ tippen.",
    ],
    [
      /exposure snapshot/i,
      "Der Budget-Snapshot für heute fehlt noch. Bitte erneut „Kampagne vorbereiten“ tippen.",
    ],
    [
      /EUR Meta snapshot|current successful EUR/i,
      "Die Meta-Kontodaten sind noch nicht startbereit. Bitte „Kampagne vorbereiten“ erneut tippen — der Abruf läuft automatisch mit.",
    ],
    [
      /brand profile/i,
      "Für Anzeigen fehlt eine gültige Facebook-Seite. Bitte Meta erneut verbinden.",
    ],
    [
      /brand asset|READY approved/i,
      "Das Creative ist nicht startbereit. Bitte ein anderes Bild wählen oder neu hochladen.",
    ],
    [
      /destination must exactly match|exact launch host|verified domain|conversion_domain/i,
      "Die Landingpage-Domain stimmt nicht mit der bestätigten Domain überein.",
    ],
    [
      /hard cap|budget exceeds/i,
      "Das Tagesbudget liegt über dem erlaubten Limit der Launch-Policy.",
    ],
    [
      /launch- and status-enabled|Active launch/i,
      "Die Launch-Policy erlaubt aktuell keine neuen Kampagnen.",
    ],
    [
      /blueprint/i,
      "Das Kampagnen-Rezept ist ungültig. Bitte erneut versuchen.",
    ],
    [
      /READ_SYNC lease/i,
      "Ein Meta-Abruf läuft gerade. Bitte kurz warten und erneut versuchen.",
    ],
  ];

  for (const [pattern, message] of rules) {
    if (pattern.test(raw)) {
      return message;
    }
  }

  if (raw) {
    const short = raw
      .replace(/^.*?:\s*/, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    if (short) {
      return `Die Kampagne konnte nicht vorbereitet werden (${short}).`;
    }
  }

  return "Die Kampagne konnte nicht vorbereitet werden. Bitte erneut versuchen.";
}

async function ensureFreezeWritesForLaunch(customer: MetaCustomer): Promise<void> {
  await setCustomerKillSwitch(customer, {
    mode: "FREEZE_WRITES",
    reason: "Automatische Freeze-Phase für Kampagnen-Vorbereitung",
  });
}

/**
 * ACTIVE brand profile is required by Meta creative page_id wiring — but the
 * customer should not fill a brand form for a simple Traffic launch. Auto-create
 * from the connected Facebook Page (+ optional Instagram actor).
 */
async function ensureActiveBrandProfileForLaunch(
  customer: MetaCustomer,
  preferredId: string | null,
  brandAssetId: string,
): Promise<string> {
  const admin = createAdminClient();

  const { data: assetRow, error: assetRowError } = await admin
    .from("brand_assets")
    .select("brand_profile_id")
    .eq("id", brandAssetId)
    .eq("user_id", customer.userId)
    .eq("platform_account_id", customer.platformAccountId)
    .maybeSingle();
  if (assetRowError) {
    serviceError(
      "brand_asset_lookup_failed",
      500,
      "Das Creative konnte nicht sicher geprüft werden.",
    );
  }
  const assetProfileId =
    typeof assetRow?.brand_profile_id === "string"
      ? assetRow.brand_profile_id
      : null;

  for (const candidateId of [preferredId, assetProfileId]) {
    if (!candidateId) continue;
    const { data: candidate, error: candidateError } = await admin
      .from("brand_profiles")
      .select("id,facebook_page_id")
      .eq("id", candidateId)
      .eq("user_id", customer.userId)
      .eq("platform_account_id", customer.platformAccountId)
      .eq("status", "ACTIVE")
      .maybeSingle();
    if (candidateError) {
      serviceError(
        "brand_profile_lookup_failed",
        500,
        "Das Brand-Profil konnte nicht sicher geprüft werden.",
      );
    }
    if (candidate?.id && candidate.facebook_page_id) {
      return candidate.id;
    }
  }

  const { data: active, error: activeError } = await admin
    .from("brand_profiles")
    .select("id,facebook_page_id")
    .eq("user_id", customer.userId)
    .eq("platform_account_id", customer.platformAccountId)
    .eq("status", "ACTIVE")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeError) {
    serviceError(
      "brand_profile_lookup_failed",
      500,
      "Das Brand-Profil konnte nicht sicher geprüft werden.",
    );
  }
  if (active?.id && active.facebook_page_id) {
    return active.id;
  }

  const [
    { data: assets, error: assetError },
    { data: account, error: accountError },
  ] = await Promise.all([
    admin
      .from("meta_assets")
      .select("asset_type,meta_asset_id")
      .eq("user_id", customer.userId)
      .eq("platform_account_id", customer.platformAccountId)
      .in("asset_type", ["facebook_page", "instagram_account"])
      .order("created_at", { ascending: false }),
    admin
      .from("platform_accounts")
      .select("account_name,instagram_account_ids")
      .eq("id", customer.platformAccountId)
      .eq("user_id", customer.userId)
      .eq("platform", "meta")
      .is("revoked_at", null)
      .maybeSingle(),
  ]);

  if (assetError || accountError || !account) {
    serviceError(
      "brand_actor_lookup_failed",
      500,
      "Die verbundenen Meta-Seiten konnten nicht sicher geprüft werden.",
    );
  }

  const facebookPageId = assets?.find(
    (asset) => asset.asset_type === "facebook_page",
  )?.meta_asset_id;
  if (!facebookPageId || !/^\d{1,64}$/.test(facebookPageId)) {
    serviceError(
      "facebook_page_required",
      409,
      "Für Anzeigen muss eine Facebook-Seite mit dem Meta-Konto verbunden sein. Bitte Meta erneut verbinden.",
    );
  }

  const selectedInstagramIds = new Set(
    Array.isArray(account.instagram_account_ids)
      ? account.instagram_account_ids.filter(
          (id): id is string =>
            typeof id === "string" && /^[0-9]{1,64}$/.test(id),
        )
      : [],
  );
  const selectedIg = assets?.find(
    (asset) =>
      asset.asset_type === "instagram_account" &&
      selectedInstagramIds.has(asset.meta_asset_id),
  )?.meta_asset_id;
  const anyIg = assets?.find(
    (asset) => asset.asset_type === "instagram_account",
  )?.meta_asset_id;
  const instagramActorId =
    selectedIg && /^\d{1,64}$/.test(selectedIg)
      ? selectedIg
      : anyIg && /^\d{1,64}$/.test(anyIg)
        ? anyIg
        : null;

  const brandName = (
    customer.accountName ||
    account.account_name ||
    "Mein Unternehmen"
  )
    .toString()
    .trim()
    .slice(0, 120) || "Mein Unternehmen";

  const { data, error } = await admin.rpc("put_brand_profile_version", {
    p_user_id: customer.userId,
    p_platform_account_id: customer.platformAccountId,
    p_display_name: brandName,
    p_brand_name: brandName,
    p_facebook_page_id: facebookPageId,
    p_instagram_actor_id: instagramActorId,
    p_guidelines: {},
    p_forbidden_content: [],
    p_generation_defaults: {},
    p_activate: true,
    p_generated_asset_approval_mode: "AUTONOMOUS_POLICY",
  });

  if (error || typeof data !== "string") {
    rpcFailure("Das Brand-Profil");
  }
  return data;
}

/**
 * Hard-cap reservation needs a COMPLETE exposure snapshot for today's sync.
 * Bootstrap via the same ensure used by Beitrag-Push — no separate customer chore.
 */
async function ensureLaunchExposureSnapshot(
  customer: MetaCustomer,
  leaseToken: string,
): Promise<void> {
  if (!customer.marketingSyncId) {
    serviceError(
      "fresh_sync_required",
      409,
      "Für den Kampagnenstart fehlen aktuelle Meta-Kontodaten.",
    );
  }

  const admin = createAdminClient();
  const { data: policy, error: policyError } = await admin
    .from("automation_policies")
    .select("id")
    .eq("user_id", customer.userId)
    .eq("platform_account_id", customer.platformAccountId)
    .eq("is_current", true)
    .eq("status", "ACTIVE")
    .eq("currency", "EUR")
    .maybeSingle();

  if (policyError || !policy?.id) {
    serviceError(
      "launch_policy_required",
      409,
      "Eine aktive Launch-Policy ist erforderlich, bevor die Kampagne vorbereitet werden kann.",
    );
  }

  // Omit p_planned_at so Postgres uses now() — avoids Vercel/DB clock skew
  // falsely failing the 2h marketing freshness gate.
  const { data, error } = await admin.rpc(
    "ensure_meta_organic_boost_exposure_snapshot",
    {
      p_platform_account_id: customer.platformAccountId,
      p_user_id: customer.userId,
      p_policy_id: policy.id,
      p_source_marketing_sync_id: customer.marketingSyncId,
      p_read_lease_token: leaseToken,
    },
  );

  if (error || !data) {
    serviceError(
      "launch_exposure_snapshot_required",
      409,
      "Der Budget-Snapshot für den Kampagnenstart konnte nicht automatisch erzeugt werden. Bitte erneut versuchen.",
    );
  }
}

export async function materializeCustomerLaunch(
  customer: MetaCustomer,
  command: LaunchCommand,
): Promise<CustomerLaunchResult> {
  requireWriteReadyCustomer(customer, "einen Aktiv-Launch vorbereitest");
  const readyCustomer = await refreshCustomerMarketingForLaunch(customer);
  // Do not rely on the UI alone — materialize SQL requires FREEZE_WRITES.
  await ensureFreezeWritesForLaunch(readyCustomer);

  const leaseToken = await claimMetaReadOperation({
    platformAccountId: readyCustomer.platformAccountId,
    userId: readyCustomer.userId,
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
    const brandProfileId = await ensureActiveBrandProfileForLaunch(
      readyCustomer,
      command.brandProfileId,
      command.brandAssetId,
    );
    await ensureLaunchExposureSnapshot(readyCustomer, leaseToken);

    // Library uploads may arrive before onboarding creates a brand profile.
    // Bind unbound CUSTOMER assets to the launch profile at prepare-time.
    const { error: bindError } = await admin.rpc(
      "bind_unbound_customer_brand_asset_for_launch",
      {
        p_user_id: readyCustomer.userId,
        p_platform_account_id: readyCustomer.platformAccountId,
        p_brand_profile_id: brandProfileId,
        p_brand_asset_id: command.brandAssetId,
      },
    );
    if (bindError) {
      console.error("launch_bind_failed", {
        message: bindError.message,
        details: bindError.details,
        hint: bindError.hint,
      });
      serviceError(
        "launch_preparation_not_ready",
        409,
        launchPreparationFailureMessage(bindError),
      );
    }
    // Omit p_planned_at so Postgres uses now() — Vercel clock skew against
    // marketing_last_success_at (DB now) was failing the 2h freshness gate.
    const commonRpcArguments = {
      p_user_id: readyCustomer.userId,
      p_platform_account_id: readyCustomer.platformAccountId,
      p_read_lease_token: leaseToken,
      p_blueprint_id: command.blueprintId,
      p_brand_profile_id: brandProfileId,
      p_brand_asset_id: command.brandAssetId,
      p_allowed_domain_id: command.allowedDomainId,
      p_budget_owner_type: command.budgetOwnerType,
      p_launch_inputs: {
        ...command.launchInputs,
        preparation_reason: command.reason,
      },
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
      console.error("launch_materialize_failed", {
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      serviceError(
        "launch_preparation_not_ready",
        409,
        launchPreparationFailureMessage(error),
      );
    }
    result = parseCustomerLaunchResult(data);
  } finally {
    try {
      await releaseMetaAccountOperation({
        platformAccountId: readyCustomer.platformAccountId,
        userId: readyCustomer.userId,
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

export async function saveCustomerBoostSettings(
  customer: MetaCustomer,
  command: BoostSettingsCommand,
): Promise<{
  settingsId: string;
  organicBoost: MetaOrganicBoostPlannerResult | null;
}> {
  if (customer.currency !== "EUR") {
    serviceError(
      "eur_account_required",
      409,
      "Beitrag-Push-Einstellungen sind derzeit ausschließlich für Werbekonten in EUR freigegeben.",
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("put_meta_boost_settings_version", {
    p_user_id: customer.userId,
    p_platform_account_id: customer.platformAccountId,
    p_boost_mode: command.boostMode,
    p_budget_mode: command.budgetMode,
    p_daily_budget_minor: command.dailyBudgetMinor,
    p_lifetime_budget_minor: command.lifetimeBudgetMinor,
    p_duration_days: command.durationDays,
    p_budget_owner_type: command.budgetOwnerType,
    p_objective: command.objective,
    p_source_filter: command.sourceFilter,
    p_default_countries: command.defaultCountries,
    p_default_cta_type: command.defaultCtaType,
    p_default_destination_url: command.defaultDestinationUrl,
    p_asset_scope: command.assetScope,
    p_asset_settings: command.assetSettings.map((asset) => ({
      meta_asset_id: asset.metaAssetId,
      included: asset.included,
      daily_budget_minor: asset.dailyBudgetMinor,
      duration_days: asset.durationDays,
    })),
  });

  if (error || typeof data !== "string") {
    rpcFailure("Die Beitrag-Push-Einstellungen");
  }

  let organicBoost: MetaOrganicBoostPlannerResult | null = null;
  if (command.boostMode === "AUTO") {
    const { data: killRow } = await admin
      .from("kill_switch_state")
      .select("mode")
      .eq("user_id", customer.userId)
      .eq("platform_account_id", customer.platformAccountId)
      .eq("scope_type", "ACCOUNT")
      .order("sequence", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (killRow?.mode === "ALLOW") {
      organicBoost = await tryRunOrganicBoostPlanner({
        customer,
        ownerPrefix: "organic-boost-settings",
      });
      organicBoost = await reviveAndDrainOrganicBoost({
        customer,
        organicBoost,
      });
    }
  }

  return { settingsId: data, organicBoost };
}

export type OrganicBoostCandidateDiagnosis = {
  isNewCount: number;
  /** is_new candidates that already have a boost link (not all-account links). */
  alreadyLinkedCount: number;
  sourceFilteredOut: number;
  assetFilteredOut: number;
  skipOverrideCount: number;
  /** Matches planner eligibility before materialize (unlinked + filters). */
  eligibleCount: number;
  sourceFilter: string | null;
  assetScope: string | null;
  boostEnabled: boolean | null;
  autoBoostNewCandidates: boolean | null;
  boostMode: string | null;
};

export type PlanCustomerOrganicBoostResult = MetaOrganicBoostPlannerResult & {
  executorRuns: number;
  executorSucceeded: number;
  executorFailed: number;
  executorLastOutcome: string | null;
  executorLastError: string | null;
  prepareDetail: string | null;
  duePlans: number;
  candidateDiagnosis: OrganicBoostCandidateDiagnosis | null;
};

async function diagnoseOrganicBoostCandidates(input: {
  userId: string;
  platformAccountId: string;
}): Promise<OrganicBoostCandidateDiagnosis> {
  const admin = createAdminClient();
  const [{ data: settings }, { data: candidates }] = await Promise.all([
    admin
      .from("meta_boost_settings")
      .select(
        "enabled,auto_boost_new_candidates,boost_mode,require_manual_approval,source_filter,asset_scope",
      )
      .eq("user_id", input.userId)
      .eq("platform_account_id", input.platformAccountId)
      .eq("is_current", true)
      .maybeSingle(),
    admin
      .from("meta_content_candidates")
      .select("id,source,meta_asset_id")
      .eq("user_id", input.userId)
      .eq("platform_account_id", input.platformAccountId)
      .eq("is_new", true)
      .limit(100),
  ]);

  const rows = Array.isArray(candidates) ? candidates : [];
  const candidateIds = rows
    .map((row) => (typeof row.id === "string" ? row.id : null))
    .filter((id): id is string => Boolean(id));

  const linkedIds = new Set<string>();
  const skipOverrideIds = new Set<string>();
  const includedAssetIds = new Set<string>();

  if (candidateIds.length > 0) {
    const [{ data: links }, { data: overrides }] = await Promise.all([
      admin
        .from("meta_organic_boost_links")
        .select("content_candidate_id")
        .eq("user_id", input.userId)
        .eq("platform_account_id", input.platformAccountId)
        .in("content_candidate_id", candidateIds),
      admin
        .from("meta_content_boost_overrides")
        .select("content_candidate_id,mode")
        .eq("platform_account_id", input.platformAccountId)
        .in("content_candidate_id", candidateIds),
    ]);

    for (const link of links ?? []) {
      if (typeof link.content_candidate_id === "string") {
        linkedIds.add(link.content_candidate_id);
      }
    }
    for (const override of overrides ?? []) {
      if (
        override.mode === "SKIP" &&
        typeof override.content_candidate_id === "string"
      ) {
        skipOverrideIds.add(override.content_candidate_id);
      }
    }
  }

  const assetScope =
    typeof settings?.asset_scope === "string" ? settings.asset_scope : null;
  const sourceFilter =
    typeof settings?.source_filter === "string"
      ? settings.source_filter
      : null;

  if (assetScope === "SELECTED") {
    const assetIds = [
      ...new Set(
        rows
          .map((row) =>
            typeof row.meta_asset_id === "string" ? row.meta_asset_id : null,
          )
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (assetIds.length > 0) {
      const { data: assetSettings } = await admin
        .from("meta_boost_asset_settings")
        .select("meta_asset_id,included")
        .eq("user_id", input.userId)
        .eq("platform_account_id", input.platformAccountId)
        .in("meta_asset_id", assetIds);
      for (const row of assetSettings ?? []) {
        if (row.included === true && typeof row.meta_asset_id === "string") {
          includedAssetIds.add(row.meta_asset_id);
        }
      }
    }
  }

  let alreadyLinkedCount = 0;
  let sourceFilteredOut = 0;
  let assetFilteredOut = 0;
  let skipOverrideCount = 0;
  let eligibleCount = 0;

  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id : null;
    if (!id) continue;
    if (linkedIds.has(id)) {
      alreadyLinkedCount += 1;
      continue;
    }
    if (skipOverrideIds.has(id)) {
      skipOverrideCount += 1;
      continue;
    }
    const source = typeof row.source === "string" ? row.source : null;
    if (
      sourceFilter &&
      sourceFilter !== "both" &&
      source &&
      source !== sourceFilter
    ) {
      sourceFilteredOut += 1;
      continue;
    }
    if (assetScope === "SELECTED") {
      const assetId =
        typeof row.meta_asset_id === "string" ? row.meta_asset_id : null;
      if (!assetId || !includedAssetIds.has(assetId)) {
        assetFilteredOut += 1;
        continue;
      }
    }
    eligibleCount += 1;
  }

  const boostMode =
    settings?.boost_mode === "AUTO" ||
    settings?.boost_mode === "REVIEW" ||
    settings?.boost_mode === "OFF"
      ? String(settings.boost_mode)
      : settings
        ? Boolean(settings.require_manual_approval)
          ? "REVIEW"
          : Boolean(settings.enabled)
            ? "AUTO"
            : "OFF"
        : null;

  return {
    isNewCount: rows.length,
    alreadyLinkedCount,
    sourceFilteredOut,
    assetFilteredOut,
    skipOverrideCount,
    eligibleCount,
    sourceFilter,
    assetScope,
    boostEnabled:
      typeof settings?.enabled === "boolean" ? settings.enabled : null,
    autoBoostNewCandidates:
      typeof settings?.auto_boost_new_candidates === "boolean"
        ? settings.auto_boost_new_candidates
        : null,
    boostMode,
  };
}

export async function planCustomerOrganicBoost(
  customer: MetaCustomer,
): Promise<PlanCustomerOrganicBoostResult> {
  // Instagram orphan repair runs inside planAndDrainOrganicBoostForAccount.
  const ensured = await planAndDrainOrganicBoostForAccount({
    platformAccountId: customer.platformAccountId,
    userId: customer.userId,
    ownerPrefix: "organic-boost-plan",
    maxRuns: 8,
  });

  const candidateDiagnosis = await diagnoseOrganicBoostCandidates({
    userId: customer.userId,
    platformAccountId: customer.platformAccountId,
  }).catch(() => null);

  if (ensured.skippedRecent) {
    return {
      status: "PLANNED",
      plansCreated: 0,
      plansExisting: 0,
      candidatesSkipped: 0,
      candidatesFailed: 0,
      candidatesConsidered: 0,
      lastError: null,
      pendingPlans: 0,
      executorRuns: 0,
      executorSucceeded: 0,
      executorFailed: 0,
      executorLastOutcome: null,
      executorLastError: null,
      prepareDetail: null,
      duePlans: 0,
      candidateDiagnosis,
    };
  }

  const planned = ensured.planner ?? {
    status: "PLANNER_RPC_FAILED",
    plansCreated: 0,
    plansExisting: 0,
    candidatesSkipped: 0,
    candidatesFailed: 0,
    candidatesConsidered: 0,
    lastError: "organic_boost_ensure_empty",
  };
  const drain = ensured.drain;

  return {
    ...planned,
    pendingPlans: drain?.duePlans ?? 0,
    executorRuns: drain?.runs ?? 0,
    executorSucceeded: drain?.succeeded ?? 0,
    executorFailed: drain?.failed ?? 0,
    executorLastOutcome: drain?.lastOutcome ?? null,
    executorLastError: drain?.lastError ?? null,
    prepareDetail: drain?.prepareDetail ?? null,
    duePlans: drain?.duePlans ?? 0,
    candidateDiagnosis,
  };
}

export async function saveCustomerBoostOverride(
  customer: MetaCustomer,
  command: BoostOverrideCommand,
): Promise<{ overrideId: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("upsert_meta_content_boost_override", {
    p_user_id: customer.userId,
    p_platform_account_id: customer.platformAccountId,
    p_content_candidate_id: command.contentCandidateId,
    p_mode: command.mode,
    p_budget_mode: command.budgetMode,
    p_daily_budget_minor: command.dailyBudgetMinor,
    p_lifetime_budget_minor: command.lifetimeBudgetMinor,
    p_duration_days: command.durationDays,
    p_cta_type: command.ctaType,
    p_destination_url: command.destinationUrl,
    p_clear_cta: command.clearCta,
    p_notes: command.notes || null,
  });

  if (error || typeof data !== "string") {
    rpcFailure("Der Beitrags-Override");
  }

  return { overrideId: data };
}

export type CustomerOrganicBoostResult = {
  outcome: string;
  planId?: string;
  status?: string;
  payloadHash?: string;
  contentCandidateId: string;
  objectStoryId?: string;
  budgetMode?: string;
  dailyBudgetMinor?: string | null;
  lifetimeBudgetMinor?: string | null;
  durationDays?: number;
  destinationUrl?: string | null;
  requireManualApproval?: boolean;
  campaignName?: string;
  adSetName?: string;
  creativeName?: string;
  adName?: string;
  objective?: string;
  reason?: string;
};

function parseOrganicBoostResult(value: unknown): CustomerOrganicBoostResult {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") {
    rpcFailure("Die Beitrag-Push-Vorbereitung");
  }
  const record = row as Record<string, unknown>;
  if (typeof record.outcome !== "string" || typeof record.content_candidate_id !== "string") {
    rpcFailure("Die Beitrag-Push-Vorbereitung");
  }

  return {
    outcome: record.outcome,
    planId: typeof record.plan_id === "string" ? record.plan_id : undefined,
    status: typeof record.status === "string" ? record.status : undefined,
    payloadHash:
      typeof record.payload_hash === "string" ? record.payload_hash : undefined,
    contentCandidateId: record.content_candidate_id,
    objectStoryId:
      typeof record.object_story_id === "string" ? record.object_story_id : undefined,
    budgetMode: typeof record.budget_mode === "string" ? record.budget_mode : undefined,
    dailyBudgetMinor:
      record.daily_budget_minor === null || record.daily_budget_minor === undefined
        ? null
        : String(record.daily_budget_minor),
    lifetimeBudgetMinor:
      record.lifetime_budget_minor === null || record.lifetime_budget_minor === undefined
        ? null
        : String(record.lifetime_budget_minor),
    durationDays:
      typeof record.duration_days === "number" ? record.duration_days : undefined,
    destinationUrl:
      record.destination_url === null || record.destination_url === undefined
        ? null
        : typeof record.destination_url === "string"
          ? record.destination_url
          : null,
    requireManualApproval:
      typeof record.require_manual_approval === "boolean"
        ? record.require_manual_approval
        : undefined,
    campaignName:
      typeof record.campaign_name === "string" ? record.campaign_name : undefined,
    adSetName: typeof record.ad_set_name === "string" ? record.ad_set_name : undefined,
    creativeName:
      typeof record.creative_name === "string" ? record.creative_name : undefined,
    adName: typeof record.ad_name === "string" ? record.ad_name : undefined,
    objective: typeof record.objective === "string" ? record.objective : undefined,
    reason: typeof record.reason === "string" ? record.reason : undefined,
  };
}

export async function materializeCustomerOrganicBoost(
  customer: MetaCustomer,
  command: OrganicBoostPrepareCommand,
): Promise<CustomerOrganicBoostResult> {
  requireWriteReadyCustomer(customer, "einen Beitrag-Push vorbereitest");
  if (!customer.marketingSyncId) {
    serviceError(
      "fresh_sync_required",
      409,
      "Vor der Beitrag-Push-Vorbereitung ist ein aktueller erfolgreicher Meta-Abruf erforderlich.",
    );
  }

  const leaseToken = await claimMetaReadOperation({
    platformAccountId: customer.platformAccountId,
    userId: customer.userId,
    ownerId: `customer-organic-boost-prepare:${randomUUID()}`,
  });
  if (!leaseToken) {
    serviceError(
      "read_snapshot_busy",
      409,
      "Ein Meta-Sync oder Planer-Lauf ist aktiv. Bitte versuche die Vorbereitung in wenigen Minuten erneut.",
    );
  }

  let result: CustomerOrganicBoostResult | null = null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc(
      "materialize_meta_customer_organic_boost_plan",
      {
        p_user_id: customer.userId,
        p_platform_account_id: customer.platformAccountId,
        p_read_lease_token: leaseToken,
        p_content_candidate_id: command.contentCandidateId,
        p_planned_at: new Date().toISOString(),
      },
    );
    if (error) {
      serviceError(
        "organic_boost_preparation_not_ready",
        409,
        "Der Beitrag-Push wurde nicht vorbereitet: FREEZE_WRITES, Boost-Einstellungen, Policy, Snapshot und Facebook-Beitrags-ID müssen erfüllt sein.",
      );
    }
    result = parseOrganicBoostResult(data);
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
          "Der Beitrag-Push wurde nicht vorbereitet, weil die sichere Read-Lease nicht freigegeben werden konnte.",
        );
      }
    }
  }

  if (!result) {
    rpcFailure("Die Beitrag-Push-Vorbereitung");
  }
  return result;
}

export async function approveCustomerOrganicBoost(
  customer: MetaCustomer,
  command: OrganicBoostApprovalCommand,
): Promise<{
  approvalId: string;
  planId: string;
  planStatus: "PENDING";
  executableAt: string;
  approvedAt: string;
}> {
  requireWriteReadyCustomer(customer, "einen Beitrag-Push freigibst");

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("approve_meta_organic_boost_canary_plan", {
    p_user_id: customer.userId,
    p_platform_account_id: customer.platformAccountId,
    p_plan_id: command.planId,
    p_expected_payload_hash: command.payloadHash,
    p_expected_object_story_id: command.objectStoryId,
    p_expected_budget_mode: command.budgetMode,
    p_expected_daily_budget_minor: command.dailyBudgetMinor,
    p_expected_lifetime_budget_minor: command.lifetimeBudgetMinor,
    p_expected_duration_days: command.durationDays,
    p_expected_destination_url: command.destinationUrl,
    p_reason: command.reason,
  });
  const row = Array.isArray(data) ? data[0] : null;

  if (error) {
    serviceError(
      "organic_boost_approval_not_ready",
      409,
      "Der Beitrag-Push ist nicht mehr exakt freigebbar. Bitte Fingerprint, FREEZE_WRITES und Plan erneut prüfen.",
    );
  }
  if (
    typeof row?.approval_id !== "string" ||
    row?.plan_id !== command.planId ||
    row?.plan_status !== "PENDING" ||
    typeof row?.executable_at !== "string" ||
    typeof row?.approved_at !== "string"
  ) {
    rpcFailure("Die Beitrag-Push-Freigabe");
  }

  return {
    approvalId: row.approval_id,
    planId: row.plan_id,
    planStatus: "PENDING",
    executableAt: row.executable_at,
    approvedAt: row.approved_at,
  };
}


function normalizeCampaignBriefNotes(notes: string): string | null {
  const trimmed = notes.trim();
  return trimmed ? trimmed : null;
}

function campaignBriefLandingHostname(landingUrl: string): string {
  return new URL(landingUrl).hostname.toLowerCase();
}

function hashCampaignBriefContent(input: {
  objective: string;
  landingUrl: string;
  notes: string | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        objective: input.objective,
        landingUrl: input.landingUrl,
        notes: input.notes,
      }),
    )
    .digest("hex");
}

export type CampaignBriefStatus = "DRAFT" | "READY" | "CONSUMED" | "ARCHIVED";

export type CampaignBriefRecord = {
  briefId: string;
  status: CampaignBriefStatus;
  objective: string;
  landingUrl: string;
  landingHostname: string;
  notes: string | null;
  briefHash: string;
  brandProfileId: string | null;
  createdAt: string;
  updatedAt: string;
  alreadyExisted?: boolean;
};

export async function saveCustomerCampaignBrief(
  customer: MetaCustomer,
  command: CampaignBriefCommand,
): Promise<{
  briefId: string;
  status: CampaignBriefStatus;
  alreadyExisted: boolean;
}> {
  const admin = createAdminClient();
  const notes = normalizeCampaignBriefNotes(command.notes);
  const landingHostname = campaignBriefLandingHostname(command.landingUrl);
  const briefHash = hashCampaignBriefContent({
    objective: command.objective,
    landingUrl: command.landingUrl,
    notes,
  });

  const { data: activeBrand, error: brandError } = await admin
    .from("brand_profiles")
    .select("id")
    .eq("user_id", customer.userId)
    .eq("platform_account_id", customer.platformAccountId)
    .eq("status", "ACTIVE")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (brandError) {
    serviceError(
      "campaign_brief_brand_lookup_failed",
      500,
      "Das aktive Brand-Profil konnte für den Kampagnen-Brief nicht geprüft werden.",
    );
  }

  const { data, error } = await admin.rpc("put_campaign_brief", {
    p_user_id: customer.userId,
    p_platform_account_id: customer.platformAccountId,
    p_objective: command.objective,
    p_landing_url: command.landingUrl,
    p_landing_hostname: landingHostname,
    p_brief_hash: briefHash,
    p_notes: notes,
    p_brand_profile_id: activeBrand?.id ?? null,
  });

  const row = firstRpcRow(data);
  if (error || !row || typeof row.brief_id !== "string") {
    rpcFailure("Der Kampagnen-Brief", error?.message);
  }

  const status = String(row.status || "DRAFT");
  if (
    status !== "DRAFT" &&
    status !== "READY" &&
    status !== "CONSUMED" &&
    status !== "ARCHIVED"
  ) {
    rpcFailure("Der Kampagnen-Brief", "unerwarteter Status");
  }

  return {
    briefId: row.brief_id,
    status,
    alreadyExisted: Boolean(row.already_existed),
  };
}

export async function archiveCustomerCampaignBrief(
  customer: MetaCustomer,
  command: CampaignBriefArchiveCommand,
): Promise<{ briefId: string; archived: true }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("archive_campaign_brief", {
    p_user_id: customer.userId,
    p_platform_account_id: customer.platformAccountId,
    p_brief_id: command.briefId,
  });

  if (error) {
    rpcFailure("Die Brief-Archivierung", error.message);
  }

  if (data !== true) {
    serviceError(
      "campaign_brief_not_found",
      404,
      "Der Kampagnen-Brief wurde nicht gefunden oder ist bereits archiviert.",
    );
  }

  return { briefId: command.briefId, archived: true };
}
