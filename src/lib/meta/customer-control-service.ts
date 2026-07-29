import "server-only";

import type {
  BrandCommand,
  KillSwitchCommand,
  PolicyCommand,
} from "@/lib/meta/customer-control-input";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type MetaCustomer = {
  userId: string;
  platformAccountId: string;
  accountName: string | null;
  currency: string | null;
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
    .select("id,account_name,marketing_currency,meta_scopes")
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

  return {
    userId: user.id,
    platformAccountId: account.id,
    accountName: account.account_name,
    currency: account.marketing_currency,
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
