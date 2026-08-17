/**
 * materialize_meta_launch_chain_plan(_v3) returns CREATED/EXISTING HELD payloads
 * without brand_asset_ids / prepared_at. parseCustomerLaunchResult requires both —
 * Traffic/Lead "Kampagne vorbereiten" failed with the opaque rpcFailure message.
 */

export type LaunchPrepareBudgetType = "DAILY" | "LIFETIME";

export function enrichCustomerLaunchRpcData(
  data: unknown,
  input: {
    brandAssetId: string;
    budgetType: LaunchPrepareBudgetType;
    preparedAt?: string;
  },
): unknown {
  const raw = Array.isArray(data) ? data[0] : data;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return data;
  }

  const record = { ...(raw as Record<string, unknown>) };
  const existingIds = Array.isArray(record.brand_asset_ids)
    ? record.brand_asset_ids.filter(
        (id): id is string =>
          typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id),
      )
    : [];

  if (existingIds.length < 1) {
    record.brand_asset_ids = [input.brandAssetId];
  } else {
    record.brand_asset_ids = existingIds;
  }

  if (typeof record.prepared_at !== "string" || !record.prepared_at.trim()) {
    record.prepared_at = input.preparedAt ?? new Date().toISOString();
  }

  if (record.budget_type !== "DAILY" && record.budget_type !== "LIFETIME") {
    record.budget_type = input.budgetType;
  }

  return record;
}

/** Missing fields that make parseCustomerLaunchResult reject the RPC payload. */
export function describeCustomerLaunchParseGaps(
  value: unknown,
): string[] {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return ["payload"];
  }
  const record = raw as Record<string, unknown>;
  const gaps: string[] = [];

  if (record.outcome !== "CREATED" && record.outcome !== "EXISTING") {
    gaps.push("outcome");
  }
  if (
    typeof record.plan_id !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(record.plan_id)
  ) {
    gaps.push("plan_id");
  }
  if (record.status !== "HELD") {
    gaps.push("status");
  }
  if (
    typeof record.payload_hash !== "string" ||
    !/^[0-9a-f]{64}$/.test(record.payload_hash)
  ) {
    gaps.push("payload_hash");
  }
  if (typeof record.objective !== "string") {
    gaps.push("objective");
  }
  if (typeof record.destination_url !== "string") {
    gaps.push("destination_url");
  }
  if (record.target_status !== "ACTIVE") {
    gaps.push("target_status");
  }
  if (
    record.budget_owner_type !== "CAMPAIGN" &&
    record.budget_owner_type !== "AD_SET"
  ) {
    gaps.push("budget_owner_type");
  }
  if (typeof record.campaign_name !== "string") {
    gaps.push("campaign_name");
  }
  if (typeof record.ad_set_name !== "string") {
    gaps.push("ad_set_name");
  }
  if (typeof record.creative_name !== "string") {
    gaps.push("creative_name");
  }
  if (typeof record.ad_name !== "string") {
    gaps.push("ad_name");
  }
  const brandAssetIds = Array.isArray(record.brand_asset_ids)
    ? record.brand_asset_ids.filter(
        (id): id is string =>
          typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id),
      )
    : [];
  if (brandAssetIds.length < 1) {
    gaps.push("brand_asset_ids");
  }
  if (typeof record.prepared_at !== "string") {
    gaps.push("prepared_at");
  }

  const budgetType =
    record.budget_type === "LIFETIME"
      ? "LIFETIME"
      : record.budget_type === "DAILY" || record.budget_type === undefined
        ? "DAILY"
        : null;
  if (!budgetType) {
    gaps.push("budget_type");
  } else if (budgetType === "DAILY") {
    if (!/^[1-9][0-9]*$/.test(String(record.daily_budget_minor ?? ""))) {
      gaps.push("daily_budget_minor");
    }
  } else {
    if (record.budget_owner_type !== "CAMPAIGN") {
      gaps.push("lifetime_budget_owner");
    }
    if (!/^[1-9][0-9]*$/.test(String(record.lifetime_budget_minor ?? ""))) {
      gaps.push("lifetime_budget_minor");
    }
    if (
      typeof record.start_time !== "string" ||
      !Number.isFinite(Date.parse(record.start_time))
    ) {
      gaps.push("start_time");
    }
    if (
      typeof record.end_time !== "string" ||
      !Number.isFinite(Date.parse(record.end_time))
    ) {
      gaps.push("end_time");
    } else if (
      typeof record.start_time === "string" &&
      Number.isFinite(Date.parse(record.start_time)) &&
      Date.parse(record.end_time) <= Date.parse(record.start_time)
    ) {
      gaps.push("end_time_order");
    }
  }

  return gaps;
}
