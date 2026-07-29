const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const MULTILINE_CONTROL_CHARACTERS = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/;

type JsonObject = Record<string, unknown>;

export class CustomerControlInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CustomerControlInputError";
    this.code = code;
  }
}

function inputError(code: string, message: string): never {
  throw new CustomerControlInputError(code, message);
}

export function asJsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    inputError("invalid_body", "Die Anfrage muss ein JSON-Objekt sein.");
  }

  return value as JsonObject;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    inputError("invalid_boolean", `${field} muss eindeutig bestätigt oder abgewählt werden.`);
  }

  return value;
}

function requiredText(
  value: unknown,
  field: string,
  minimumLength: number,
  maximumLength: number,
): string {
  if (typeof value !== "string") {
    inputError("invalid_text", `${field} ist ungültig.`);
  }

  const normalized = value.trim();

  if (
    normalized.length < minimumLength ||
    normalized.length > maximumLength ||
    CONTROL_CHARACTERS.test(normalized)
  ) {
    inputError(
      "invalid_text",
      `${field} muss zwischen ${minimumLength} und ${maximumLength} Zeichen lang sein.`,
    );
  }

  return normalized;
}

function optionalText(value: unknown, field: string, maximumLength: number): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  return requiredText(value, field, 1, maximumLength);
}

export function parseEuroAmountToMinor(value: unknown, field: string): string {
  if (typeof value !== "string") {
    inputError("invalid_amount", `${field} muss als EUR-Betrag angegeben werden.`);
  }

  const normalized = value.trim().replace(",", ".");

  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    inputError(
      "invalid_amount",
      `${field} muss ein positiver EUR-Betrag mit höchstens zwei Nachkommastellen sein.`,
    );
  }

  const [major, fraction = ""] = normalized.split(".");
  const minor = BigInt(major) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));

  if (minor <= BigInt(0) || minor > MAX_POSTGRES_BIGINT) {
    inputError("invalid_amount", `${field} liegt außerhalb des zulässigen Wertebereichs.`);
  }

  return minor.toString();
}

export type PolicyCommand = {
  accountDailyHardCapMinor: string;
  campaignDailyHardCapMinor: string;
  allowBudgetChanges: boolean;
  allowStatusChanges: boolean;
  allowNewLaunches: boolean;
  enableAutomation: boolean;
};

export function parsePolicyCommand(value: unknown): PolicyCommand {
  const body = asJsonObject(value);
  const accountDailyHardCapMinor = parseEuroAmountToMinor(
    body.accountDailyHardCap,
    "Das Konto-Tageslimit",
  );
  const campaignDailyHardCapMinor = parseEuroAmountToMinor(
    body.campaignDailyHardCap,
    "Das Kampagnen-Tageslimit",
  );
  const allowBudgetChanges = requiredBoolean(
    body.allowBudgetChanges,
    "Budgetänderungen",
  );
  const allowStatusChanges = requiredBoolean(
    body.allowStatusChanges,
    "Statusänderungen",
  );
  const allowNewLaunches = requiredBoolean(
    body.allowNewLaunches,
    "Neue aktive Ads",
  );
  const enableAutomation = requiredBoolean(
    body.enableAutomation,
    "Die Autonomie-Aktivierung",
  );

  if (BigInt(campaignDailyHardCapMinor) > BigInt(accountDailyHardCapMinor)) {
    inputError(
      "campaign_cap_above_account_cap",
      "Das Kampagnen-Tageslimit darf das Konto-Tageslimit nicht überschreiten.",
    );
  }

  if (allowNewLaunches && !allowStatusChanges) {
    inputError(
      "launch_requires_status_changes",
      "Neue aktive Ads benötigen die Freigabe für Statusänderungen.",
    );
  }

  return {
    accountDailyHardCapMinor,
    campaignDailyHardCapMinor,
    allowBudgetChanges,
    allowStatusChanges,
    allowNewLaunches,
    enableAutomation,
  };
}

const KILL_SWITCH_MODES = ["ALLOW", "FREEZE_WRITES", "PAUSE_MANAGED"] as const;
export type KillSwitchMode = (typeof KILL_SWITCH_MODES)[number];

export type KillSwitchCommand = {
  mode: KillSwitchMode;
  reason: string;
};

export function parseKillSwitchCommand(value: unknown): KillSwitchCommand {
  const body = asJsonObject(value);

  if (
    typeof body.mode !== "string" ||
    !KILL_SWITCH_MODES.includes(body.mode as KillSwitchMode)
  ) {
    inputError("invalid_kill_switch_mode", "Der gewählte Sicherheitsmodus ist ungültig.");
  }

  return {
    mode: body.mode as KillSwitchMode,
    reason: requiredText(body.reason, "Die Begründung", 8, 500),
  };
}

const APPROVAL_MODES = ["AUTONOMOUS_POLICY", "CUSTOMER_REVIEW"] as const;
export type GeneratedAssetApprovalMode = (typeof APPROVAL_MODES)[number];

export type BrandCommand = {
  displayName: string;
  brandName: string;
  guidelines: {
    toneOfVoice: string;
    visualStyle: string;
    colorPalette: string[];
  };
  forbiddenContent: string[];
  generationDefaults: {
    callToActionStyle: string;
    preferredFormat: string;
  };
  generatedAssetApprovalMode: GeneratedAssetApprovalMode;
};

function parseList(
  value: unknown,
  field: string,
  separator: RegExp,
  maximumItems: number,
  maximumItemLength: number,
): string[] {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  if (typeof value !== "string") {
    inputError("invalid_list", `${field} ist ungültig.`);
  }

  const text = value.trim();

  if (
    text.length > maximumItems * (maximumItemLength + 1) ||
    MULTILINE_CONTROL_CHARACTERS.test(text)
  ) {
    inputError("invalid_list", `${field} enthält unzulässige Zeichen oder ist zu lang.`);
  }

  const items = [...new Set(text.split(separator).map((item) => item.trim()).filter(Boolean))];

  if (
    items.length > maximumItems ||
    items.some(
      (item) => item.length > maximumItemLength || CONTROL_CHARACTERS.test(item),
    )
  ) {
    inputError("invalid_list", `${field} enthält zu viele oder zu lange Einträge.`);
  }

  return items;
}

export function parseBrandCommand(value: unknown): BrandCommand {
  const body = asJsonObject(value);

  if (
    typeof body.generatedAssetApprovalMode !== "string" ||
    !APPROVAL_MODES.includes(
      body.generatedAssetApprovalMode as GeneratedAssetApprovalMode,
    )
  ) {
    inputError("invalid_approval_mode", "Der Freigabemodus für neue Assets ist ungültig.");
  }

  return {
    displayName: requiredText(body.displayName, "Der Profilname", 1, 120),
    brandName: requiredText(body.brandName, "Der Markenname", 1, 120),
    guidelines: {
      toneOfVoice: optionalText(body.toneOfVoice, "Die Tonalität", 500),
      visualStyle: optionalText(body.visualStyle, "Der visuelle Stil", 1_000),
      colorPalette: parseList(body.colorPalette, "Die Farbpalette", /[,;\n]/, 12, 64),
    },
    forbiddenContent: parseList(
      body.forbiddenContent,
      "Ausgeschlossene Inhalte",
      /\n/,
      50,
      200,
    ),
    generationDefaults: {
      callToActionStyle: optionalText(
        body.callToActionStyle,
        "Der Call-to-Action-Stil",
        300,
      ),
      preferredFormat: optionalText(
        body.preferredFormat,
        "Das bevorzugte Format",
        120,
      ),
    },
    generatedAssetApprovalMode:
      body.generatedAssetApprovalMode as GeneratedAssetApprovalMode,
  };
}
