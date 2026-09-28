const META_STANDARD_DAILY_RESERVE_MULTIPLIER = 1.75;

export const LAUNCH_BUDGET_CAP_MESSAGE =
  "Das Tagesbudget liegt über dem aktuell freigegebenen Tageslimit.";

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
