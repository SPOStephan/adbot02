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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const META_OBJECT_ID_PATTERN = /^[0-9]{1,64}$/;
const META_IMAGE_HASH_PATTERN = /^[0-9a-f]{16,128}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MIME_TYPES = ["image/png", "image/jpeg"] as const;

function requiredUuid(value: unknown, field: string): string {
  const normalized = requiredText(value, field, 36, 36);
  if (!UUID_PATTERN.test(normalized)) {
    inputError("invalid_uuid", `${field} ist ungültig.`);
  }
  return normalized.toLowerCase();
}

function requiredEnum<const T extends readonly string[]>(
  value: unknown,
  field: string,
  allowed: T,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value as T[number])) {
    inputError("invalid_option", `${field} ist ungültig.`);
  }
  return value as T[number];
}

function assertExactKeys(
  body: Record<string, unknown>,
  allowedKeys: readonly string[],
  field: string,
): void {
  const allowed = new Set(allowedKeys);
  const unknownKeys = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    inputError(
      "unknown_field",
      `${field} enthält ein nicht erlaubtes Feld: ${unknownKeys[0]}.`,
    );
  }
}

const AUTOMATION_SCOPE_SELECTION_TYPES = ["CAMPAIGN", "TARGET"] as const;
const AUTOMATION_SCOPE_STATUSES = ["MANAGED", "SUSPENDED"] as const;

export type AutomationScopeCommand = {
  selectionType: (typeof AUTOMATION_SCOPE_SELECTION_TYPES)[number];
  selectionId: string;
  status: (typeof AUTOMATION_SCOPE_STATUSES)[number];
  reason: string;
};

export function parseAutomationScopeCommand(value: unknown): AutomationScopeCommand {
  const body = asJsonObject(value);
  assertExactKeys(
    body,
    ["selectionType", "selectionId", "status", "reason"],
    "Der Automationsbereich-Befehl",
  );

  return {
    selectionType: requiredEnum(
      body.selectionType,
      "Der Auswahltyp",
      AUTOMATION_SCOPE_SELECTION_TYPES,
    ),
    selectionId: requiredUuid(body.selectionId, "Die Auswahl-ID"),
    status: requiredEnum(
      body.status,
      "Der Zielstatus",
      AUTOMATION_SCOPE_STATUSES,
    ),
    reason: requiredText(body.reason, "Die Begründung", 8, 500),
  };
}

function requiredPositiveMinorUnits(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    inputError("invalid_minor_units", `${field} ist ungültig.`);
  }

  const parsed = BigInt(value);
  if (parsed > MAX_POSTGRES_BIGINT) {
    inputError("invalid_minor_units", `${field} liegt außerhalb des zulässigen Wertebereichs.`);
  }

  return parsed.toString();
}

export type BudgetCanaryMaterializationCommand = {
  reason: string;
};

export function parseBudgetCanaryMaterializationCommand(
  value: unknown,
): BudgetCanaryMaterializationCommand {
  const body = asJsonObject(value);
  assertExactKeys(
    body,
    ["reason", "confirmation"],
    "Der Budget-Canary-Vorbereitungsbefehl",
  );

  if (body.confirmation !== "CANARY VORBEREITEN") {
    inputError(
      "confirmation_required",
      "Geben Sie zur Vorbereitung exakt „CANARY VORBEREITEN“ ein.",
    );
  }

  return {
    reason: requiredText(body.reason, "Die Begründung", 12, 500),
  };
}

export type BudgetCanaryApprovalCommand = {
  planId: string;
  payloadHash: string;
  currentBudgetMinor: string;
  intendedBudgetMinor: string;
  reason: string;
};

export function parseBudgetCanaryApprovalCommand(
  value: unknown,
): BudgetCanaryApprovalCommand {
  const body = asJsonObject(value);
  assertExactKeys(
    body,
    [
      "planId",
      "payloadHash",
      "currentBudgetMinor",
      "intendedBudgetMinor",
      "reason",
      "confirmation",
    ],
    "Der Budget-Canary-Befehl",
  );

  const payloadHash = requiredText(body.payloadHash, "Der Plan-Fingerprint", 64, 64);
  if (!SHA256_PATTERN.test(payloadHash)) {
    inputError("invalid_hash", "Der Plan-Fingerprint ist ungültig.");
  }

  if (body.confirmation !== "BUDGET ÄNDERN") {
    inputError(
      "confirmation_required",
      "Geben Sie zur Bestätigung exakt „BUDGET ÄNDERN“ ein.",
    );
  }

  return {
    planId: requiredUuid(body.planId, "Die Plan-ID"),
    payloadHash,
    currentBudgetMinor: requiredPositiveMinorUnits(
      body.currentBudgetMinor,
      "Das aktuelle Budget",
    ),
    intendedBudgetMinor: requiredPositiveMinorUnits(
      body.intendedBudgetMinor,
      "Das Zielbudget",
    ),
    reason: requiredText(body.reason, "Die Begründung", 12, 500),
  };
}

function normalizedHostname(value: unknown, field: string): string {
  const text = requiredText(value, field, 3, 253).toLowerCase().replace(/\.$/, "");
  if (
    !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(text) ||
    text.includes("..") ||
    !text.includes(".") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(text)
  ) {
    inputError("invalid_hostname", `${field} muss ein gültiger öffentlicher Hostname sein.`);
  }

  const labels = text.split(".");
  if (
    labels.some(
      (label) =>
        label.length < 1 ||
        label.length > 63 ||
        label.startsWith("-") ||
        label.endsWith("-"),
    )
  ) {
    inputError("invalid_hostname", `${field} muss ein gültiger öffentlicher Hostname sein.`);
  }

  return text;
}

const DOMAIN_ACTIONS = ["register", "confirm"] as const;
const DOMAIN_VERIFICATION_METHODS = ["CUSTOMER_CONFIRMATION"] as const;

export type DomainCommand =
  | {
      action: "register";
      hostname: string;
      registrableDomain: string;
      verificationMethod: "CUSTOMER_CONFIRMATION";
      verificationEvidence: Record<string, unknown>;
    }
  | { action: "confirm"; domainId: string };

export function parseDomainCommand(value: unknown): DomainCommand {
  const body = asJsonObject(value);
  const action = requiredEnum(body.action, "Die Domain-Aktion", DOMAIN_ACTIONS);

  if (action === "confirm") {
    assertExactKeys(body, ["action", "domainId"], "Der Domain-Befehl");
    return {
      action,
      domainId: requiredUuid(body.domainId, "Die Domain-ID"),
    };
  }

  assertExactKeys(
    body,
    ["action", "hostname", "registrableDomain", "verificationMethod"],
    "Der Domain-Befehl",
  );
  const hostname = normalizedHostname(body.hostname, "Der Hostname");
  const registrableDomain = normalizedHostname(
    body.registrableDomain,
    "Die registrierbare Domain",
  );
  if (
    hostname !== registrableDomain &&
    !hostname.endsWith(`.${registrableDomain}`)
  ) {
    inputError(
      "domain_scope_mismatch",
      "Der Hostname gehört nicht zur angegebenen registrierbaren Domain.",
    );
  }

  return {
    action,
    hostname,
    registrableDomain,
    verificationMethod: requiredEnum(
      body.verificationMethod,
      "Die Verifikationsmethode",
      DOMAIN_VERIFICATION_METHODS,
    ),
    verificationEvidence: {
      contractVersion: 1,
      confirmation: "customer_entered_domain",
    },
  };
}

export const META_OBJECTIVES = [
  "APP_INSTALLS",
  "BRAND_AWARENESS",
  "CONVERSIONS",
  "EVENT_RESPONSES",
  "LEAD_GENERATION",
  "LINK_CLICKS",
  "LOCAL_AWARENESS",
  "MESSAGES",
  "OFFER_CLAIMS",
  "OUTCOME_APP_PROMOTION",
  "OUTCOME_AWARENESS",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_LEADS",
  "OUTCOME_SALES",
  "OUTCOME_TRAFFIC",
  "PAGE_LIKES",
  "POST_ENGAGEMENT",
  "PRODUCT_CATALOG_SALES",
  "REACH",
  "STORE_VISITS",
  "VIDEO_VIEWS",
] as const;
export type MetaObjective = (typeof META_OBJECTIVES)[number];

const BLUEPRINT_ACTIONS = ["save", "activate"] as const;
const BLUEPRINT_REQUIRED_INPUTS = [
  "destination_url",
  "campaign_name",
  "ad_set_name",
  "creative_name",
  "ad_name",
] as const;
type BlueprintRequiredInput = (typeof BLUEPRINT_REQUIRED_INPUTS)[number];

function secretLikeKey(key: string): boolean {
  return new Set([
    "accesstoken",
    "authorization",
    "clientsecret",
    "appsecret",
    "refreshtoken",
    "password",
    "privatekey",
    "apikey",
  ]).has(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

function assertSafeJson(value: unknown, field: string, depth = 0): void {
  if (depth > 20) {
    inputError("json_too_deep", `${field} ist zu tief verschachtelt.`);
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => assertSafeJson(entry, field, depth + 1));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, nested]) => {
      if (secretLikeKey(key)) {
        inputError("secret_field_forbidden", `${field} enthält ein geheimes Feld.`);
      }
      assertSafeJson(nested, field, depth + 1);
    });
    return;
  }
  inputError("invalid_json", `${field} enthält einen ungültigen JSON-Wert.`);
}

function parseBlueprintPayload(value: unknown): Record<string, unknown> {
  const payload = asJsonObject(value);
  const exactSections = ["ad", "ad_set", "campaign", "creative"];
  const keys = Object.keys(payload).sort();
  if (
    keys.length !== exactSections.length ||
    keys.some((key, index) => key !== exactSections[index]) ||
    exactSections.some(
      (section) =>
        !payload[section] ||
        typeof payload[section] !== "object" ||
        Array.isArray(payload[section]),
    )
  ) {
    inputError(
      "invalid_blueprint_payload",
      "Das Blueprint benötigt genau die Objektbereiche campaign, ad_set, creative und ad.",
    );
  }

  assertSafeJson(payload, "Das Blueprint");
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 256 * 1024) {
    inputError("blueprint_too_large", "Das Blueprint überschreitet 256 KiB.");
  }
  return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
}

function parseRequiredInputs(value: unknown): BlueprintRequiredInput[] {
  if (!Array.isArray(value)) {
    inputError("invalid_required_inputs", "Die erforderlichen Launch-Felder sind ungültig.");
  }
  const unique = [...new Set(value)];
  if (
    unique.length !== value.length ||
    unique.length > BLUEPRINT_REQUIRED_INPUTS.length ||
    unique.some(
      (entry) =>
        typeof entry !== "string" ||
        !BLUEPRINT_REQUIRED_INPUTS.includes(entry as BlueprintRequiredInput),
    )
  ) {
    inputError(
      "invalid_required_inputs",
      "Die erforderlichen Launch-Felder sind nicht erlaubt oder nicht eindeutig.",
    );
  }
  return unique as BlueprintRequiredInput[];
}

export type BlueprintCommand =
  | {
      action: "save";
      objective: MetaObjective;
      name: string;
      payloadTemplate: Record<string, unknown>;
      requiredInputs: BlueprintRequiredInput[];
    }
  | { action: "activate"; blueprintId: string };

export function parseBlueprintCommand(value: unknown): BlueprintCommand {
  const body = asJsonObject(value);
  const action = requiredEnum(body.action, "Die Blueprint-Aktion", BLUEPRINT_ACTIONS);
  if (action === "activate") {
    assertExactKeys(body, ["action", "blueprintId"], "Der Blueprint-Befehl");
    return {
      action,
      blueprintId: requiredUuid(body.blueprintId, "Die Blueprint-ID"),
    };
  }

  assertExactKeys(
    body,
    ["action", "objective", "name", "payloadTemplate", "requiredInputs"],
    "Der Blueprint-Befehl",
  );
  const objective = requiredEnum(body.objective, "Das Kampagnenziel", META_OBJECTIVES);
  const payloadTemplate = parseBlueprintPayload(body.payloadTemplate);
  const campaign = payloadTemplate.campaign as Record<string, unknown>;
  if (
    campaign.objective !== undefined &&
    campaign.objective !== objective
  ) {
    inputError(
      "blueprint_objective_mismatch",
      "Das Kampagnenziel im Blueprint stimmt nicht mit der Blueprint-ID überein.",
    );
  }

  return {
    action,
    objective,
    name: requiredText(body.name, "Der Blueprint-Name", 1, 255),
    payloadTemplate,
    requiredInputs: parseRequiredInputs(body.requiredInputs),
  };
}

export type AssetImportCommand = {
  brandProfileId: string;
  sourceCreativeId: string;
};

export function parseAssetImportCommand(value: unknown): AssetImportCommand {
  const body = asJsonObject(value);
  assertExactKeys(
    body,
    ["brandProfileId", "sourceCreativeId"],
    "Der Asset-Import-Befehl",
  );
  const sourceCreativeId = requiredText(
    body.sourceCreativeId,
    "Die Meta-Creative-ID",
    1,
    64,
  );
  if (!META_OBJECT_ID_PATTERN.test(sourceCreativeId)) {
    inputError("invalid_meta_creative_id", "Die Meta-Creative-ID ist ungültig.");
  }
  return {
    brandProfileId: requiredUuid(body.brandProfileId, "Die Brand-Profil-ID"),
    sourceCreativeId,
  };
}

export type ValidatedImportedAsset = {
  sha256: string;
  mimeType: (typeof MIME_TYPES)[number];
  byteSize: number;
  width: number;
  height: number;
  metaImageHash: string | null;
};

export function assertValidatedImportedAsset(
  value: ValidatedImportedAsset,
): ValidatedImportedAsset {
  if (!SHA256_PATTERN.test(value.sha256)) {
    inputError("invalid_asset_sha256", "Der Asset-Hash ist ungültig.");
  }
  if (!MIME_TYPES.includes(value.mimeType)) {
    inputError("invalid_asset_mime", "Der Asset-MIME-Typ ist ungültig.");
  }
  if (
    !Number.isSafeInteger(value.byteSize) ||
    value.byteSize <= 0 ||
    value.byteSize > 10 * 1024 * 1024 ||
    !Number.isSafeInteger(value.width) ||
    value.width < 256 ||
    value.width > 4096 ||
    !Number.isSafeInteger(value.height) ||
    value.height < 256 ||
    value.height > 4096 ||
    (value.metaImageHash !== null &&
      !META_IMAGE_HASH_PATTERN.test(value.metaImageHash))
  ) {
    inputError("invalid_asset_metadata", "Die validierten Asset-Metadaten sind ungültig.");
  }
  return value;
}

const BUDGET_OWNER_TYPES = ["CAMPAIGN", "AD_SET"] as const;

function optionalLaunchName(value: unknown, field: string): string | undefined {
  const normalized = optionalText(value, field, 240);
  return normalized || undefined;
}

function requiredHttpsUrl(value: unknown): string {
  const text = requiredText(value, "Die Ziel-URL", 9, 2_048);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    inputError("invalid_destination_url", "Die Ziel-URL ist ungültig.");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname.includes(".") ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    inputError(
      "invalid_destination_url",
      "Die Ziel-URL muss eine öffentliche HTTPS-URL ohne Login, Port oder Fragment sein.",
    );
  }
  return url.toString();
}

const LAUNCH_BUDGET_TYPES = ["DAILY", "LIFETIME"] as const;

type LaunchCommon = {
  blueprintId: string;
  brandProfileId: string;
  brandAssetId: string;
  allowedDomainId: string;
  reason: string;
  launchInputs: {
    destination_url: string;
    campaign_name?: string;
    ad_set_name?: string;
    creative_name?: string;
    ad_name?: string;
  };
};

export type LaunchCommand = LaunchCommon &
  (
    | {
        budgetType: "DAILY";
        budgetOwnerType: (typeof BUDGET_OWNER_TYPES)[number];
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

function requiredUtcTimestamp(value: unknown, field: string): string {
  const text = requiredText(value, field, 20, 30);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text)) {
    inputError("invalid_timestamp", `${field} muss ein UTC-Zeitpunkt im ISO-8601-Format sein.`);
  }
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    inputError("invalid_timestamp", `${field} ist kein gültiger Zeitpunkt.`);
  }
  return new Date(parsed).toISOString();
}

function assertLifetimeWindow(startTime: string, endTime: string): void {
  const durationMs = Date.parse(endTime) - Date.parse(startTime);
  if (durationMs <= 60 * 60 * 1000 || durationMs > 90 * 24 * 60 * 60 * 1000) {
    inputError(
      "invalid_lifetime_window",
      "Die Laufzeit muss länger als eine Stunde und höchstens 90 Tage sein.",
    );
  }
}

export function parseLaunchCommand(value: unknown): LaunchCommand {
  const body = asJsonObject(value);
  const budgetType =
    body.budgetType === undefined
      ? "DAILY"
      : requiredEnum(body.budgetType, "Die Budgetart", LAUNCH_BUDGET_TYPES);
  const commonKeys = [
    "blueprintId",
    "brandProfileId",
    "brandAssetId",
    "allowedDomainId",
    "budgetOwnerType",
    "budgetType",
    "destinationUrl",
    "campaignName",
    "adSetName",
    "creativeName",
    "adName",
    "reason",
    "confirmation",
  ];
  assertExactKeys(
    body,
    budgetType === "DAILY"
      ? [...commonKeys, "dailyBudget"]
      : [...commonKeys, "lifetimeBudget", "startTime", "endTime"],
    "Der Aktiv-Launch-Vorbereitungsbefehl",
  );

  if (body.confirmation !== "AKTIV-LAUNCH VORBEREITEN") {
    inputError(
      "confirmation_required",
      "Geben Sie zur Vorbereitung exakt „AKTIV-LAUNCH VORBEREITEN“ ein.",
    );
  }

  const common: LaunchCommon = {
    blueprintId: requiredUuid(body.blueprintId, "Die Blueprint-ID"),
    brandProfileId: requiredUuid(body.brandProfileId, "Die Brand-Profil-ID"),
    brandAssetId: requiredUuid(body.brandAssetId, "Die Brand-Asset-ID"),
    allowedDomainId: requiredUuid(body.allowedDomainId, "Die Domain-ID"),
    reason: requiredText(body.reason, "Die Begründung", 12, 500),
    launchInputs: {
      destination_url: requiredHttpsUrl(body.destinationUrl),
      campaign_name: optionalLaunchName(body.campaignName, "Der Kampagnenname"),
      ad_set_name: optionalLaunchName(body.adSetName, "Der Ad-Set-Name"),
      creative_name: optionalLaunchName(body.creativeName, "Der Creative-Name"),
      ad_name: optionalLaunchName(body.adName, "Der Anzeigenname"),
    },
  };
  const budgetOwnerType = requiredEnum(
    body.budgetOwnerType,
    "Der Budgetträger",
    BUDGET_OWNER_TYPES,
  );

  if (budgetType === "DAILY") {
    return {
      ...common,
      budgetType,
      budgetOwnerType,
      dailyBudgetMinor: parseEuroAmountToMinor(
        body.dailyBudget,
        "Das Launch-Tagesbudget",
      ),
    };
  }

  if (budgetOwnerType !== "CAMPAIGN") {
    inputError(
      "invalid_budget_owner",
      "Ein Laufzeitbudget muss für diesen Canary auf Kampagnenebene liegen.",
    );
  }
  const startTime = requiredUtcTimestamp(body.startTime, "Der Laufzeitbeginn");
  const endTime = requiredUtcTimestamp(body.endTime, "Das Laufzeitende");
  assertLifetimeWindow(startTime, endTime);

  return {
    ...common,
    budgetType,
    budgetOwnerType: "CAMPAIGN",
    lifetimeBudgetMinor: parseEuroAmountToMinor(
      body.lifetimeBudget,
      "Das Launch-Laufzeitbudget",
    ),
    startTime,
    endTime,
  };
}

type LaunchApprovalCommon = {
  planId: string;
  payloadHash: string;
  objective: string;
  destinationUrl: string;
  targetStatus: "ACTIVE";
  campaignName: string;
  adSetName: string;
  creativeName: string;
  adName: string;
  reason: string;
};

export type LaunchApprovalCommand = LaunchApprovalCommon &
  (
    | {
        budgetType: "DAILY";
        budgetOwnerType: (typeof BUDGET_OWNER_TYPES)[number];
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

export function parseLaunchApprovalCommand(value: unknown): LaunchApprovalCommand {
  const body = asJsonObject(value);
  const budgetType =
    body.budgetType === undefined
      ? "DAILY"
      : requiredEnum(body.budgetType, "Die Budgetart", LAUNCH_BUDGET_TYPES);
  const commonKeys = [
    "planId",
    "payloadHash",
    "objective",
    "destinationUrl",
    "targetStatus",
    "budgetOwnerType",
    "budgetType",
    "campaignName",
    "adSetName",
    "creativeName",
    "adName",
    "reason",
    "confirmation",
  ];
  assertExactKeys(
    body,
    budgetType === "DAILY"
      ? [...commonKeys, "dailyBudgetMinor"]
      : [...commonKeys, "lifetimeBudgetMinor", "startTime", "endTime"],
    "Der Aktiv-Launch-Freigabebefehl",
  );

  const payloadHash = requiredText(body.payloadHash, "Der Plan-Fingerprint", 64, 64);
  if (!SHA256_PATTERN.test(payloadHash)) {
    inputError("invalid_hash", "Der Plan-Fingerprint ist ungültig.");
  }
  if (body.confirmation !== "AKTIV-LAUNCH FREIGEBEN") {
    inputError(
      "confirmation_required",
      "Geben Sie zur Freigabe exakt „AKTIV-LAUNCH FREIGEBEN“ ein.",
    );
  }

  const objective = requiredText(body.objective, "Das Kampagnenziel", 3, 64);
  if (!/^[A-Z0-9_]+$/.test(objective)) {
    inputError("invalid_objective", "Das Kampagnenziel ist ungültig.");
  }
  const common: LaunchApprovalCommon = {
    planId: requiredUuid(body.planId, "Die Plan-ID"),
    payloadHash,
    objective,
    destinationUrl: requiredHttpsUrl(body.destinationUrl),
    targetStatus: requiredEnum(body.targetStatus, "Der Launch-Zielstatus", ["ACTIVE"] as const),
    campaignName: requiredText(body.campaignName, "Der Kampagnenname", 1, 240),
    adSetName: requiredText(body.adSetName, "Der Ad-Set-Name", 1, 240),
    creativeName: requiredText(body.creativeName, "Der Creative-Name", 1, 240),
    adName: requiredText(body.adName, "Der Anzeigenname", 1, 240),
    reason: requiredText(body.reason, "Die Begründung", 12, 500),
  };
  const budgetOwnerType = requiredEnum(
    body.budgetOwnerType,
    "Der Budgetträger",
    BUDGET_OWNER_TYPES,
  );

  if (budgetType === "DAILY") {
    return {
      ...common,
      budgetType,
      budgetOwnerType,
      dailyBudgetMinor: requiredPositiveMinorUnits(
        body.dailyBudgetMinor,
        "Das Launch-Tagesbudget",
      ),
    };
  }

  if (budgetOwnerType !== "CAMPAIGN") {
    inputError(
      "invalid_budget_owner",
      "Ein Laufzeitbudget muss für diesen Canary auf Kampagnenebene liegen.",
    );
  }
  const startTime = requiredUtcTimestamp(body.startTime, "Der Laufzeitbeginn");
  const endTime = requiredUtcTimestamp(body.endTime, "Das Laufzeitende");
  assertLifetimeWindow(startTime, endTime);

  return {
    ...common,
    budgetType,
    budgetOwnerType: "CAMPAIGN",
    lifetimeBudgetMinor: requiredPositiveMinorUnits(
      body.lifetimeBudgetMinor,
      "Das Launch-Laufzeitbudget",
    ),
    startTime,
    endTime,
  };
}

const BOOST_SOURCE_FILTERS = ["facebook", "instagram", "both"] as const;
const BOOST_OBJECTIVES = ["OUTCOME_ENGAGEMENT", "POST_ENGAGEMENT"] as const;
const BOOST_MODES = ["OFF", "REVIEW", "AUTO"] as const;
const BOOST_OVERRIDE_MODES = ["INHERIT", "SKIP", "BOOST"] as const;
const BOOST_COUNTRIES = [
  "DE", "AT", "CH", "NL", "BE", "FR", "IT", "ES", "PL", "US", "GB", "IE",
  "SE", "DK", "NO", "FI", "CZ", "PT", "LU",
] as const;

export type BoostMode = (typeof BOOST_MODES)[number];

export type BoostSettingsCommand = {
  boostMode: BoostMode;
  budgetMode: "DAILY" | "LIFETIME";
  dailyBudgetMinor: string | null;
  lifetimeBudgetMinor: string | null;
  durationDays: number;
  budgetOwnerType: "CAMPAIGN" | "AD_SET";
  objective: (typeof BOOST_OBJECTIVES)[number];
  sourceFilter: (typeof BOOST_SOURCE_FILTERS)[number];
  defaultCountries: string[];
  defaultCtaType: string | null;
  defaultDestinationUrl: string | null;
};

export type BoostOverrideCommand = {
  contentCandidateId: string;
  mode: (typeof BOOST_OVERRIDE_MODES)[number];
  budgetMode: "DAILY" | "LIFETIME" | null;
  dailyBudgetMinor: string | null;
  lifetimeBudgetMinor: string | null;
  durationDays: number | null;
  ctaType: string | null;
  destinationUrl: string | null;
  clearCta: boolean;
  notes: string;
};

export type OrganicBoostPrepareCommand = {
  contentCandidateId: string;
};

export type OrganicBoostApprovalCommand = {
  planId: string;
  payloadHash: string;
  objectStoryId: string;
  budgetMode: "DAILY" | "LIFETIME";
  dailyBudgetMinor: string | null;
  lifetimeBudgetMinor: string | null;
  durationDays: number;
  destinationUrl: string | null;
  reason: string;
};

function optionalHttpsUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requiredHttpsUrl(value);
}

function requiredDurationDays(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 90) {
    inputError(
      "invalid_duration_days",
      "Die Laufzeit muss eine ganze Zahl zwischen 1 und 90 Tagen sein.",
    );
  }
  return value;
}

export function parseBoostSettingsCommand(value: unknown): BoostSettingsCommand {
  const body = asJsonObject(value);
  assertExactKeys(
    body,
    [
      "boostMode",
      "budgetMode",
      "dailyBudgetMinor",
      "lifetimeBudgetMinor",
      "durationDays",
      "budgetOwnerType",
      "objective",
      "sourceFilter",
      "defaultCountries",
      "defaultCtaType",
      "defaultDestinationUrl",
    ],
    "Der Beitrag-Push-Befehl",
  );

  const boostMode = requiredEnum(body.boostMode, "Der Beitrag-Push-Modus", BOOST_MODES);
  const budgetMode = requiredEnum(
    body.budgetMode,
    "Der Budgetmodus",
    LAUNCH_BUDGET_TYPES,
  );
  const budgetOwnerType = requiredEnum(
    body.budgetOwnerType,
    "Der Budgetträger",
    BUDGET_OWNER_TYPES,
  );
  // Contribution pushes optimize for post interactions / likes by default.
  const objective = requiredEnum(body.objective, "Das Werbeziel", BOOST_OBJECTIVES);
  const sourceFilter = requiredEnum(
    body.sourceFilter,
    "Der Quellenfilter",
    BOOST_SOURCE_FILTERS,
  );
  const durationDays = requiredDurationDays(body.durationDays);

  if (boostMode === "AUTO" && budgetMode !== "DAILY") {
    inputError(
      "invalid_auto_budget",
      "Der Automatik-Modus benötigt ein Tagesbudget und eine Laufzeit in Tagen.",
    );
  }

  if (!Array.isArray(body.defaultCountries) || body.defaultCountries.length < 1) {
    inputError("invalid_countries", "Mindestens ein Zielland ist erforderlich.");
  }
  const defaultCountries = body.defaultCountries.map((country) => {
    if (typeof country !== "string" || !(BOOST_COUNTRIES as readonly string[]).includes(country)) {
      inputError("invalid_countries", "Ein Zielland ist nicht zulässig.");
    }
    return country;
  });

  let dailyBudgetMinor: string | null = null;
  let lifetimeBudgetMinor: string | null = null;
  if (budgetMode === "DAILY") {
    if (body.lifetimeBudgetMinor !== null && body.lifetimeBudgetMinor !== undefined) {
      inputError("invalid_budget", "Tagesbudget und Laufzeitbudget schließen sich aus.");
    }
    dailyBudgetMinor = parseEuroAmountToMinor(body.dailyBudgetMinor, "Das Tagesbudget");
  } else {
    if (body.dailyBudgetMinor !== null && body.dailyBudgetMinor !== undefined) {
      inputError("invalid_budget", "Tagesbudget und Laufzeitbudget schließen sich aus.");
    }
    if (budgetOwnerType !== "CAMPAIGN") {
      inputError(
        "invalid_budget_owner",
        "Ein Laufzeitbudget muss auf Kampagnenebene liegen.",
      );
    }
    lifetimeBudgetMinor = parseEuroAmountToMinor(
      body.lifetimeBudgetMinor,
      "Das Laufzeitbudget",
    );
  }

  const defaultCtaType =
    body.defaultCtaType === null || body.defaultCtaType === undefined || body.defaultCtaType === ""
      ? null
      : requiredText(body.defaultCtaType, "Der CTA-Typ", 2, 64).toUpperCase();
  if (defaultCtaType && !/^[A-Z0-9_]+$/.test(defaultCtaType)) {
    inputError("invalid_cta_type", "Der CTA-Typ ist ungültig.");
  }
  const defaultDestinationUrl = optionalHttpsUrl(body.defaultDestinationUrl);
  if ((defaultCtaType === null) !== (defaultDestinationUrl === null)) {
    inputError(
      "invalid_cta_pair",
      "CTA-Typ und Linkziel müssen gemeinsam gesetzt oder gemeinsam leer sein.",
    );
  }

  return {
    boostMode,
    budgetMode,
    dailyBudgetMinor,
    lifetimeBudgetMinor,
    durationDays,
    budgetOwnerType: budgetMode === "LIFETIME" ? "CAMPAIGN" : budgetOwnerType,
    objective,
    sourceFilter,
    defaultCountries,
    defaultCtaType,
    defaultDestinationUrl,
  };
}

export function parseBoostOverrideCommand(value: unknown): BoostOverrideCommand {
  const body = asJsonObject(value);
  assertExactKeys(
    body,
    [
      "contentCandidateId",
      "mode",
      "budgetMode",
      "dailyBudgetMinor",
      "lifetimeBudgetMinor",
      "durationDays",
      "ctaType",
      "destinationUrl",
      "clearCta",
      "notes",
    ],
    "Der Beitrags-Override-Befehl",
  );

  const mode = requiredEnum(body.mode, "Der Override-Modus", BOOST_OVERRIDE_MODES);
  const clearCta = requiredBoolean(body.clearCta, "Das CTA-Zurücksetzen");
  const budgetMode =
    body.budgetMode === null || body.budgetMode === undefined || body.budgetMode === ""
      ? null
      : requiredEnum(body.budgetMode, "Der Budgetmodus", LAUNCH_BUDGET_TYPES);

  let dailyBudgetMinor: string | null = null;
  let lifetimeBudgetMinor: string | null = null;
  if (budgetMode === "DAILY") {
    dailyBudgetMinor = parseEuroAmountToMinor(body.dailyBudgetMinor, "Das Override-Tagesbudget");
    if (body.lifetimeBudgetMinor !== null && body.lifetimeBudgetMinor !== undefined) {
      inputError("invalid_budget", "Tagesbudget und Laufzeitbudget schließen sich aus.");
    }
  } else if (budgetMode === "LIFETIME") {
    lifetimeBudgetMinor = parseEuroAmountToMinor(
      body.lifetimeBudgetMinor,
      "Das Override-Laufzeitbudget",
    );
    if (body.dailyBudgetMinor !== null && body.dailyBudgetMinor !== undefined) {
      inputError("invalid_budget", "Tagesbudget und Laufzeitbudget schließen sich aus.");
    }
  } else if (
    (body.dailyBudgetMinor !== null && body.dailyBudgetMinor !== undefined)
    || (body.lifetimeBudgetMinor !== null && body.lifetimeBudgetMinor !== undefined)
  ) {
    inputError("invalid_budget", "Budgetbeträge erfordern einen Budgetmodus.");
  }

  const durationDays =
    body.durationDays === null || body.durationDays === undefined || body.durationDays === ""
      ? null
      : requiredDurationDays(body.durationDays);

  const ctaType =
    clearCta || body.ctaType === null || body.ctaType === undefined || body.ctaType === ""
      ? null
      : requiredText(body.ctaType, "Der CTA-Typ", 2, 64).toUpperCase();
  if (ctaType && !/^[A-Z0-9_]+$/.test(ctaType)) {
    inputError("invalid_cta_type", "Der CTA-Typ ist ungültig.");
  }
  const destinationUrl = clearCta ? null : optionalHttpsUrl(body.destinationUrl);
  if (!clearCta && (ctaType === null) !== (destinationUrl === null)) {
    inputError(
      "invalid_cta_pair",
      "CTA-Typ und Linkziel müssen gemeinsam gesetzt oder gemeinsam leer sein.",
    );
  }

  return {
    contentCandidateId: requiredUuid(body.contentCandidateId, "Die Beitrags-ID"),
    mode,
    budgetMode,
    dailyBudgetMinor,
    lifetimeBudgetMinor,
    durationDays,
    ctaType,
    destinationUrl,
    clearCta,
    notes: optionalText(body.notes, "Die Notiz", 500),
  };
}

export function parseOrganicBoostPrepareCommand(
  value: unknown,
): OrganicBoostPrepareCommand {
  const body = asJsonObject(value);
  assertExactKeys(body, ["contentCandidateId"], "Der Beitrag-Push-Prepare-Befehl");
  return {
    contentCandidateId: requiredUuid(body.contentCandidateId, "Die Beitrags-ID"),
  };
}

export function parseOrganicBoostApprovalCommand(
  value: unknown,
): OrganicBoostApprovalCommand {
  const body = asJsonObject(value);
  assertExactKeys(
    body,
    [
      "planId",
      "payloadHash",
      "objectStoryId",
      "budgetMode",
      "dailyBudgetMinor",
      "lifetimeBudgetMinor",
      "durationDays",
      "destinationUrl",
      "reason",
      "confirmation",
    ],
    "Der Beitrag-Push-Freigabebefehl",
  );

  if (body.confirmation !== "BEITRAG BEWERBEN") {
    inputError(
      "confirmation_required",
      "Geben Sie zur Freigabe exakt „BEITRAG BEWERBEN“ ein.",
    );
  }

  const payloadHash = requiredText(body.payloadHash, "Der Plan-Fingerprint", 64, 64);
  if (!SHA256_PATTERN.test(payloadHash)) {
    inputError("invalid_hash", "Der Plan-Fingerprint ist ungültig.");
  }

  const budgetMode = requiredEnum(
    body.budgetMode,
    "Der Budgetmodus",
    LAUNCH_BUDGET_TYPES,
  );
  let dailyBudgetMinor: string | null = null;
  let lifetimeBudgetMinor: string | null = null;
  if (budgetMode === "DAILY") {
    dailyBudgetMinor = requiredPositiveMinorUnits(
      body.dailyBudgetMinor,
      "Das Boost-Tagesbudget",
    );
  } else {
    lifetimeBudgetMinor = requiredPositiveMinorUnits(
      body.lifetimeBudgetMinor,
      "Das Boost-Laufzeitbudget",
    );
  }

  return {
    planId: requiredUuid(body.planId, "Die Plan-ID"),
    payloadHash,
    objectStoryId: requiredText(body.objectStoryId, "Die Object-Story-ID", 3, 255),
    budgetMode,
    dailyBudgetMinor,
    lifetimeBudgetMinor,
    durationDays: requiredDurationDays(body.durationDays),
    destinationUrl: optionalHttpsUrl(body.destinationUrl),
    reason: requiredText(body.reason, "Die Begründung", 12, 500),
  };
}
