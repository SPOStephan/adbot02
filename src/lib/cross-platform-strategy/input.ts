import {
  isStrategyCurrency,
  isStrategyObjective,
  isStrategyPlatformId,
  type StrategyPlatformId,
} from "@/lib/cross-platform-strategy/catalog";
import type { StrategyPlannerRequest } from "@/lib/cross-platform-strategy/types";
import { CustomerControlInputError } from "@/lib/meta/customer-control-input";

const MAX_DAILY_BUDGET_MINOR = 100_000_000;

function inputError(code: string, message: string): never {
  throw new CustomerControlInputError(code, message);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    inputError("invalid_body", "Die Strategieanfrage muss ein JSON-Objekt sein.");
  }
  return value as Record<string, unknown>;
}

function parseDailyBudgetMinor(value: unknown): number {
  if (typeof value !== "string") {
    inputError("invalid_daily_budget", "Das Tagesbudget ist ungültig.");
  }

  const normalized = value.trim().replace(",", ".");
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) {
    inputError(
      "invalid_daily_budget",
      "Das Tagesbudget muss ein positiver Betrag mit höchstens zwei Nachkommastellen sein.",
    );
  }

  const major = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const minor = major * 100 + fraction;
  if (!Number.isSafeInteger(minor) || minor < 100 || minor > MAX_DAILY_BUDGET_MINOR) {
    inputError(
      "invalid_daily_budget",
      "Das Tagesbudget muss zwischen 1 und 1.000.000 Währungseinheiten liegen.",
    );
  }
  return minor;
}

function parsePlatforms(value: unknown): StrategyPlatformId[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    inputError(
      "invalid_platforms",
      "Wähle mindestens eine und höchstens zehn Plattformen.",
    );
  }

  const platforms = value.map((item) => {
    if (typeof item !== "string" || !isStrategyPlatformId(item)) {
      inputError("invalid_platform", "Eine ausgewählte Plattform ist ungültig.");
    }
    return item;
  });
  const unique = [...new Set(platforms)];
  if (unique.length !== platforms.length) {
    inputError("duplicate_platform", "Eine Plattform wurde mehrfach ausgewählt.");
  }
  return unique;
}

export function parseStrategyPlannerRequest(value: unknown): StrategyPlannerRequest {
  const body = asRecord(value);
  const allowedKeys = new Set([
    "objective",
    "currency",
    "dailyBudget",
    "selectedPlatforms",
  ]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    inputError("unexpected_field", "Die Strategieanfrage enthält unbekannte Felder.");
  }

  if (typeof body.objective !== "string" || !isStrategyObjective(body.objective)) {
    inputError("invalid_objective", "Das Werbeziel ist ungültig.");
  }
  if (typeof body.currency !== "string") {
    inputError("invalid_currency", "Die Währung ist ungültig.");
  }
  const currency = body.currency.trim().toUpperCase();
  if (!isStrategyCurrency(currency)) {
    inputError(
      "invalid_currency",
      "Diese Währung wird vom Strategieplaner noch nicht unterstützt.",
    );
  }

  return {
    objective: body.objective,
    currency,
    dailyBudgetMinor: parseDailyBudgetMinor(body.dailyBudget),
    selectedPlatforms: parsePlatforms(body.selectedPlatforms),
  };
}
