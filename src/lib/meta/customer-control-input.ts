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

export type LaunchCommand = {
  blueprintId: string;
  brandProfileId: string;
  brandAssetId: string;
  allowedDomainId: string;
  budgetOwnerType: (typeof BUDGET_OWNER_TYPES)[number];
  dailyBudgetMinor: string;
  launchInputs: {
    destination_url: string;
    campaign_name?: string;
    ad_set_name?: string;
    creative_name?: string;
    ad_name?: string;
  };
};

export function parseLaunchCommand(value: unknown): LaunchCommand {
  const body = asJsonObject(value);
  assertExactKeys(
    body,
    [
      "blueprintId",
      "brandProfileId",
      "brandAssetId",
      "allowedDomainId",
      "budgetOwnerType",
      "dailyBudget",
      "destinationUrl",
      "campaignName",
      "adSetName",
      "creativeName",
      "adName",
    ],
    "Der Launch-Befehl",
  );
  return {
    blueprintId: requiredUuid(body.blueprintId, "Die Blueprint-ID"),
    brandProfileId: requiredUuid(body.brandProfileId, "Die Brand-Profil-ID"),
    brandAssetId: requiredUuid(body.brandAssetId, "Die Brand-Asset-ID"),
    allowedDomainId: requiredUuid(body.allowedDomainId, "Die Domain-ID"),
    budgetOwnerType: requiredEnum(
      body.budgetOwnerType,
      "Der Budgetträger",
      BUDGET_OWNER_TYPES,
    ),
    dailyBudgetMinor: parseEuroAmountToMinor(
      body.dailyBudget,
      "Das Launch-Tagesbudget",
    ),
    launchInputs: {
      destination_url: requiredHttpsUrl(body.destinationUrl),
      campaign_name: optionalLaunchName(body.campaignName, "Der Kampagnenname"),
      ad_set_name: optionalLaunchName(body.adSetName, "Der Ad-Set-Name"),
      creative_name: optionalLaunchName(body.creativeName, "Der Creative-Name"),
      ad_name: optionalLaunchName(body.adName, "Der Anzeigenname"),
    },
  };
}
