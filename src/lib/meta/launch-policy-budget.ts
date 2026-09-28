const META_STANDARD_DAILY_RESERVE_MULTIPLIER = 1.75;

export const LAUNCH_BUDGET_CAP_MESSAGE =
  "Das Tagesbudget liegt über dem aktuell freigegebenen Tageslimit.";

export type LaunchBudgetCapFailure = {
  code:
    | "launch_campaign_budget_cap_exceeded"
    | "launch_account_budget_cap_exceeded";
  message: string;
};

const NON_DELIVERING_META_STATUSES = new Set([
  "PAUSED",
  "CAMPAIGN_PAUSED",
  "ADSET_PAUSED",
  "ARCHIVED",
  "DELETED",
  "COMPLETED",
  "CAMPAIGN_COMPLETED",
]);

export function isNonDeliveringMetaStatus(
  status: string | null | undefined,
  effectiveStatus: string | null | undefined,
): boolean {
  return (
    NON_DELIVERING_META_STATUSES.has(String(status ?? "").toUpperCase()) ||
    NON_DELIVERING_META_STATUSES.has(
      String(effectiveStatus ?? "").toUpperCase(),
    )
  );
}

function formatMinorEuro(value: string): string {
  const minor = Number(value);
  if (!Number.isSafeInteger(minor) || minor < 0) return "–";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(minor / 100);
}

export function classifyLaunchBudgetCapFailure(
  raw: string,
): LaunchBudgetCapFailure | null {
  const campaignMatch = raw.match(
    /Campaign daily hard cap would be exceeded \(reserved (\d+) \/ cap (\d+) minor units\)/i,
  );
  if (campaignMatch) {
    return {
      code: "launch_campaign_budget_cap_exceeded",
      message: `Für diesen Kampagnenstart sind einschließlich Metas Tagesflex ${formatMinorEuro(campaignMatch[1])} freizugeben; das aktuelle Kampagnen-Tageslimit beträgt ${formatMinorEuro(campaignMatch[2])}. Das eingegebene Tagesbudget selbst bleibt unverändert.`,
    };
  }

  const accountMatch = raw.match(
    /Account daily hard cap would be exceeded \(reserved (\d+) \/ cap (\d+) minor units\)/i,
  );
  if (accountMatch) {
    return {
      code: "launch_account_budget_cap_exceeded",
      message: `Mit diesem neuen Start wären für von Adbot gesteuerte Kampagnen insgesamt bis zu ${formatMinorEuro(accountMatch[1])} pro Tag reserviert; das Adbot-Konto-Tageslimit beträgt ${formatMinorEuro(accountMatch[2])}. Eigenständig in Meta verwaltete Kampagnen werden nicht eingerechnet.`,
    };
  }

  return null;
}

function parseEuroInputToMinor(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
  const [major, fraction = ""] = normalized.split(".");
  const minor = Number(major) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

function positiveMinor(value: number | null): number {
  return value != null && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function formatMinorInput(value: number): string {
  return (value / 100).toFixed(2);
}

export type LaunchPolicyLimitSuggestion = {
  accountDailyHardCap: string;
  campaignDailyHardCap: string;
  requiredCampaignDailyHardCap: string;
};

export function suggestLaunchPolicyLimits(input: {
  dailyBudget: string;
  currentAccountDailyHardCapMinor: number | null;
  currentCampaignDailyHardCapMinor: number | null;
}): LaunchPolicyLimitSuggestion | null {
  const dailyBudgetMinor = parseEuroInputToMinor(input.dailyBudget);
  if (dailyBudgetMinor === null) return null;

  const requiredCampaignCap = Math.ceil(
    dailyBudgetMinor * META_STANDARD_DAILY_RESERVE_MULTIPLIER,
  );
  const campaignCap = Math.max(
    requiredCampaignCap,
    positiveMinor(input.currentCampaignDailyHardCapMinor),
  );
  const accountCap = Math.max(
    campaignCap,
    positiveMinor(input.currentAccountDailyHardCapMinor),
  );

  return {
    accountDailyHardCap: formatMinorInput(accountCap),
    campaignDailyHardCap: formatMinorInput(campaignCap),
    requiredCampaignDailyHardCap: formatMinorInput(requiredCampaignCap),
  };
}
