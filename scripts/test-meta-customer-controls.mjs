import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const inputSource = await readFile(
  path.join(root, "src/lib/meta/customer-control-input.ts"),
  "utf8",
);
const transpiledInput = ts.transpileModule(inputSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const inputModuleUrl = `data:text/javascript;base64,${Buffer.from(
  transpiledInput,
).toString("base64")}`;
const {
  CustomerControlInputError,
  parseAssetImportCommand,
  parseAutomationScopeCommand,
  parseBlueprintCommand,
  parseBrandCommand,
  parseBudgetCanaryApprovalCommand,
  parseBudgetCanaryMaterializationCommand,
  parseDomainCommand,
  parseEuroAmountToMinor,
  parseKillSwitchCommand,
  parseLaunchApprovalCommand,
  parseLaunchCommand,
  parsePolicyCommand,
} = await import(inputModuleUrl);

function expectInputError(callback, expectedCode) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof CustomerControlInputError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

assert.equal(parseEuroAmountToMinor("100", "Limit"), "10000");
assert.equal(parseEuroAmountToMinor("100,25", "Limit"), "10025");
assert.equal(parseEuroAmountToMinor("0.01", "Limit"), "1");
assert.equal(
  parseEuroAmountToMinor("92233720368547758.07", "Limit"),
  "9223372036854775807",
);
expectInputError(() => parseEuroAmountToMinor(100, "Limit"), "invalid_amount");
expectInputError(() => parseEuroAmountToMinor("1e3", "Limit"), "invalid_amount");
expectInputError(() => parseEuroAmountToMinor("-1", "Limit"), "invalid_amount");
expectInputError(
  () => parseEuroAmountToMinor("92233720368547758.08", "Limit"),
  "invalid_amount",
);

assert.deepEqual(
  parsePolicyCommand({
    accountDailyHardCap: "250,00",
    campaignDailyHardCap: "75.00",
    allowBudgetChanges: true,
    allowStatusChanges: true,
    allowNewLaunches: true,
    enableAutomation: true,
  }),
  {
    accountDailyHardCapMinor: "25000",
    campaignDailyHardCapMinor: "7500",
    allowBudgetChanges: true,
    allowStatusChanges: true,
    allowNewLaunches: true,
    enableAutomation: true,
  },
);
expectInputError(
  () =>
    parsePolicyCommand({
      accountDailyHardCap: "50",
      campaignDailyHardCap: "75",
      allowBudgetChanges: true,
      allowStatusChanges: true,
      allowNewLaunches: false,
      enableAutomation: true,
    }),
  "campaign_cap_above_account_cap",
);
expectInputError(
  () =>
    parsePolicyCommand({
      accountDailyHardCap: "100",
      campaignDailyHardCap: "50",
      allowBudgetChanges: true,
      allowStatusChanges: false,
      allowNewLaunches: true,
      enableAutomation: true,
    }),
  "launch_requires_status_changes",
);

assert.deepEqual(
  parseKillSwitchCommand({
    mode: "PAUSE_MANAGED",
    reason: "Kundenseitiger Sicherheitsstopp",
  }),
  {
    mode: "PAUSE_MANAGED",
    reason: "Kundenseitiger Sicherheitsstopp",
  },
);
assert.deepEqual(
  parseKillSwitchCommand({
    mode: "ALLOW",
  }),
  {
    mode: "ALLOW",
    reason: "Kunde hat automatische Meta-Schreibvorgänge freigegeben",
  },
);
assert.deepEqual(
  parseKillSwitchCommand({
    mode: "FREEZE_WRITES",
    reason: "kurz",
  }),
  {
    mode: "FREEZE_WRITES",
    reason: "Kunde hat neue Meta-Schreibvorgänge gestoppt",
  },
);
expectInputError(
  () => parseKillSwitchCommand({ mode: "DELETE_ALL", reason: "Nicht erlaubt" }),
  "invalid_kill_switch_mode",
);

assert.deepEqual(
  parseAutomationScopeCommand({
    selectionType: "CAMPAIGN",
    selectionId: "11111111-1111-4111-8111-111111111111",
    status: "MANAGED",
    reason: "Expliziter Budget-Canary für eine Kampagne",
  }),
  {
    selectionType: "CAMPAIGN",
    selectionId: "11111111-1111-4111-8111-111111111111",
    status: "MANAGED",
    reason: "Expliziter Budget-Canary für eine Kampagne",
  },
);
expectInputError(
  () =>
    parseAutomationScopeCommand({
      selectionType: "CAMPAIGN",
      selectionId: "11111111-1111-4111-8111-111111111111",
      status: "MANAGED",
      reason: "Expliziter Budget-Canary für eine Kampagne",
      platformAccountId: "nicht erlaubt",
    }),
  "unknown_field",
);

const validBudgetCanaryMaterializationCommand = {
  reason: "Kontrollierter erster gehaltener Budget-Canary",
  confirmation: "CANARY VORBEREITEN",
};
assert.deepEqual(
  parseBudgetCanaryMaterializationCommand(validBudgetCanaryMaterializationCommand),
  { reason: "Kontrollierter erster gehaltener Budget-Canary" },
);
expectInputError(
  () =>
    parseBudgetCanaryMaterializationCommand({
      ...validBudgetCanaryMaterializationCommand,
      confirmation: "SOFORT AUSFÜHREN",
    }),
  "confirmation_required",
);
expectInputError(
  () =>
    parseBudgetCanaryMaterializationCommand({
      ...validBudgetCanaryMaterializationCommand,
      dailyBudgetMinor: "1000",
    }),
  "unknown_field",
);

const validBudgetCanaryCommand = {
  planId: "22222222-2222-4222-8222-222222222222",
  payloadHash: "a".repeat(64),
  currentBudgetMinor: "5000",
  intendedBudgetMinor: "5500",
  reason: "Kontrollierter erster Budget-Canary",
  confirmation: "BUDGET ÄNDERN",
};
assert.deepEqual(parseBudgetCanaryApprovalCommand(validBudgetCanaryCommand), {
  planId: "22222222-2222-4222-8222-222222222222",
  payloadHash: "a".repeat(64),
  currentBudgetMinor: "5000",
  intendedBudgetMinor: "5500",
  reason: "Kontrollierter erster Budget-Canary",
});
expectInputError(
  () =>
    parseBudgetCanaryApprovalCommand({
      ...validBudgetCanaryCommand,
      payloadHash: "z".repeat(64),
    }),
  "invalid_hash",
);
expectInputError(
  () =>
    parseBudgetCanaryApprovalCommand({
      ...validBudgetCanaryCommand,
      currentBudgetMinor: 5000,
    }),
  "invalid_minor_units",
);
expectInputError(
  () =>
    parseBudgetCanaryApprovalCommand({
      ...validBudgetCanaryCommand,
      confirmation: "JA",
    }),
  "confirmation_required",
);
expectInputError(
  () =>
    parseBudgetCanaryApprovalCommand({
      ...validBudgetCanaryCommand,
      platformAccountId: "nicht erlaubt",
    }),
  "unknown_field",
);

assert.deepEqual(
  parseBrandCommand({
    displayName: "Primäre Brand",
    brandName: "Beispiel GmbH",
    toneOfVoice: "Kompetent und direkt",
    visualStyle: "Klare Flächen, authentische Produktbilder",
    colorPalette: "#0F172A, #2563EB; #FFFFFF, #2563EB",
    forbiddenContent: "Unbelegte Versprechen\nSensible Merkmale",
    callToActionStyle: "Sachlich und konkret",
    preferredFormat: "1:1 Feed",
    generatedAssetApprovalMode: "AUTONOMOUS_POLICY",
  }),
  {
    displayName: "Primäre Brand",
    brandName: "Beispiel GmbH",
    guidelines: {
      toneOfVoice: "Kompetent und direkt",
      visualStyle: "Klare Flächen, authentische Produktbilder",
      colorPalette: ["#0F172A", "#2563EB", "#FFFFFF"],
    },
    forbiddenContent: ["Unbelegte Versprechen", "Sensible Merkmale"],
    generationDefaults: {
      callToActionStyle: "Sachlich und konkret",
      preferredFormat: "1:1 Feed",
    },
    generatedAssetApprovalMode: "AUTONOMOUS_POLICY",
  },
);
expectInputError(
  () =>
    parseBrandCommand({
      displayName: "Brand",
      brandName: "Brand",
      generatedAssetApprovalMode: "AUTO_WITHOUT_POLICY",
    }),
  "invalid_approval_mode",
);

const domainDraft = parseDomainCommand({
  action: "register",
  hostname: "WWW.Example.DE.",
  registrableDomain: "example.de",
  verificationMethod: "CUSTOMER_CONFIRMATION",
});
assert.deepEqual(domainDraft, {
  action: "register",
  hostname: "www.example.de",
  registrableDomain: "example.de",
  verificationMethod: "CUSTOMER_CONFIRMATION",
  verificationEvidence: {
    contractVersion: 1,
    confirmation: "customer_entered_domain",
  },
});
assert.deepEqual(
  parseDomainCommand({
    action: "confirm",
    domainId: "11111111-1111-4111-8111-111111111111",
  }),
  {
    action: "confirm",
    domainId: "11111111-1111-4111-8111-111111111111",
  },
);
expectInputError(
  () =>
    parseDomainCommand({
      action: "register",
      hostname: "www.example.de",
      registrableDomain: "other.de",
      verificationMethod: "CUSTOMER_CONFIRMATION",
    }),
  "domain_scope_mismatch",
);
expectInputError(
  () =>
    parseDomainCommand({
      action: "confirm",
      domainId: "11111111-1111-4111-8111-111111111111",
      platformAccountId: "22222222-2222-4222-8222-222222222222",
    }),
  "unknown_field",
);

const blueprintPayload = {
  campaign: { special_ad_categories: [] },
  ad_set: {
    billing_event: "IMPRESSIONS",
    optimization_goal: "LINK_CLICKS",
    targeting: { geo_locations: { countries: ["DE"] } },
  },
  creative: { object_story_spec: { link_data: { message: "Mehr erfahren" } } },
  ad: {},
};
assert.deepEqual(
  parseBlueprintCommand({
    action: "save",
    objective: "OUTCOME_TRAFFIC",
    name: "Traffic Blueprint",
    payloadTemplate: blueprintPayload,
    requiredInputs: ["destination_url"],
  }),
  {
    action: "save",
    objective: "OUTCOME_TRAFFIC",
    name: "Traffic Blueprint",
    payloadTemplate: blueprintPayload,
    requiredInputs: ["destination_url"],
  },
);
assert.deepEqual(
  parseBlueprintCommand({
    action: "activate",
    blueprintId: "22222222-2222-4222-8222-222222222222",
  }),
  {
    action: "activate",
    blueprintId: "22222222-2222-4222-8222-222222222222",
  },
);
expectInputError(
  () =>
    parseBlueprintCommand({
      action: "save",
      objective: "OUTCOME_TRAFFIC",
      name: "Unsafe",
      payloadTemplate: {
        ...blueprintPayload,
        creative: { access_token: "never" },
      },
      requiredInputs: ["destination_url"],
    }),
  "secret_field_forbidden",
);

assert.deepEqual(
  parseAssetImportCommand({
    brandProfileId: "33333333-3333-4333-8333-333333333333",
    sourceCreativeId: "120000000000001",
  }),
  {
    brandProfileId: "33333333-3333-4333-8333-333333333333",
    sourceCreativeId: "120000000000001",
  },
);
expectInputError(
  () =>
    parseAssetImportCommand({
      brandProfileId: "33333333-3333-4333-8333-333333333333",
      sourceCreativeId: "https://example.test/image.jpg",
    }),
  "invalid_meta_creative_id",
);
expectInputError(
  () =>
    parseAssetImportCommand({
      brandProfileId: "33333333-3333-4333-8333-333333333333",
      sourceCreativeId: "120000000000001",
      imageUrl: "https://scontent.example.test/forbidden.jpg",
    }),
  "unknown_field",
);

assert.deepEqual(
  parseLaunchCommand({
    blueprintId: "22222222-2222-4222-8222-222222222222",
    brandProfileId: "33333333-3333-4333-8333-333333333333",
    brandAssetId: "44444444-4444-4444-8444-444444444444",
    allowedDomainId: "11111111-1111-4111-8111-111111111111",
    budgetOwnerType: "AD_SET",
    dailyBudget: "20,50",
    destinationUrl: "https://www.example.de/angebot",
    campaignName: "Sommer",
    reason: "Kontrollierter Staging-Aktiv-Launch.",
    confirmation: "AKTIV-LAUNCH VORBEREITEN",
  }),
  {
    blueprintId: "22222222-2222-4222-8222-222222222222",
    brandProfileId: "33333333-3333-4333-8333-333333333333",
    brandAssetId: "44444444-4444-4444-8444-444444444444",
    allowedDomainId: "11111111-1111-4111-8111-111111111111",
    budgetType: "DAILY",
    budgetOwnerType: "AD_SET",
    dailyBudgetMinor: "2050",
    reason: "Kontrollierter Staging-Aktiv-Launch.",
    launchInputs: {
      destination_url: "https://www.example.de/angebot",
      campaign_name: "Sommer",
      ad_set_name: undefined,
      creative_name: undefined,
      ad_name: undefined,
    },
  },
);

assert.deepEqual(
  parseLaunchCommand({
    blueprintId: "22222222-2222-4222-8222-222222222222",
    brandProfileId: "33333333-3333-4333-8333-333333333333",
    brandAssetId: "44444444-4444-4444-8444-444444444444",
    allowedDomainId: "11111111-1111-4111-8111-111111111111",
    budgetType: "LIFETIME",
    budgetOwnerType: "CAMPAIGN",
    lifetimeBudget: "15,00",
    startTime: "2026-08-03T10:00:00Z",
    endTime: "2026-08-10T10:00:00Z",
    destinationUrl: "https://www.example.de/angebot",
    campaignName: "Lifetime Sommer",
    reason: "Kontrollierter Staging-Lifetime-Launch.",
    confirmation: "AKTIV-LAUNCH VORBEREITEN",
  }),
  {
    blueprintId: "22222222-2222-4222-8222-222222222222",
    brandProfileId: "33333333-3333-4333-8333-333333333333",
    brandAssetId: "44444444-4444-4444-8444-444444444444",
    allowedDomainId: "11111111-1111-4111-8111-111111111111",
    budgetType: "LIFETIME",
    budgetOwnerType: "CAMPAIGN",
    lifetimeBudgetMinor: "1500",
    startTime: "2026-08-03T10:00:00.000Z",
    endTime: "2026-08-10T10:00:00.000Z",
    reason: "Kontrollierter Staging-Lifetime-Launch.",
    launchInputs: {
      destination_url: "https://www.example.de/angebot",
      campaign_name: "Lifetime Sommer",
      ad_set_name: undefined,
      creative_name: undefined,
      ad_name: undefined,
    },
  },
);
expectInputError(
  () =>
    parseLaunchCommand({
      blueprintId: "22222222-2222-4222-8222-222222222222",
      brandProfileId: "33333333-3333-4333-8333-333333333333",
      brandAssetId: "44444444-4444-4444-8444-444444444444",
      allowedDomainId: "11111111-1111-4111-8111-111111111111",
      budgetType: "LIFETIME",
      budgetOwnerType: "CAMPAIGN",
      lifetimeBudget: "15,00",
      dailyBudget: "5,00",
      startTime: "2026-08-03T10:00:00Z",
      endTime: "2026-08-10T10:00:00Z",
      destinationUrl: "https://www.example.de/angebot",
      reason: "Mischbudget darf nicht vorbereitet werden.",
      confirmation: "AKTIV-LAUNCH VORBEREITEN",
    }),
  "unknown_field",
);
expectInputError(
  () =>
    parseLaunchCommand({
      blueprintId: "22222222-2222-4222-8222-222222222222",
      brandProfileId: "33333333-3333-4333-8333-333333333333",
      brandAssetId: "44444444-4444-4444-8444-444444444444",
      allowedDomainId: "11111111-1111-4111-8111-111111111111",
      budgetType: "LIFETIME",
      budgetOwnerType: "AD_SET",
      lifetimeBudget: "15,00",
      startTime: "2026-08-03T10:00:00Z",
      endTime: "2026-08-10T10:00:00Z",
      destinationUrl: "https://www.example.de/angebot",
      reason: "Falscher Lifetime-Budgetträger.",
      confirmation: "AKTIV-LAUNCH VORBEREITEN",
    }),
  "invalid_budget_owner",
);
expectInputError(
  () =>
    parseLaunchCommand({
      blueprintId: "22222222-2222-4222-8222-222222222222",
      brandProfileId: "33333333-3333-4333-8333-333333333333",
      brandAssetId: "44444444-4444-4444-8444-444444444444",
      allowedDomainId: "11111111-1111-4111-8111-111111111111",
      budgetType: "LIFETIME",
      budgetOwnerType: "CAMPAIGN",
      lifetimeBudget: "15,00",
      startTime: "2026-08-03T10:00:00Z",
      endTime: "2026-08-03T10:30:00Z",
      destinationUrl: "https://www.example.de/angebot",
      reason: "Ungültiges Lifetime-Zeitfenster.",
      confirmation: "AKTIV-LAUNCH VORBEREITEN",
    }),
  "invalid_lifetime_window",
);
expectInputError(
  () =>
    parseLaunchCommand({
      blueprintId: "22222222-2222-4222-8222-222222222222",
      brandProfileId: "33333333-3333-4333-8333-333333333333",
      brandAssetId: "44444444-4444-4444-8444-444444444444",
      allowedDomainId: "11111111-1111-4111-8111-111111111111",
      budgetOwnerType: "AD_SET",
      dailyBudget: "20",
      destinationUrl: "https://www.example.de/angebot",
      reason: "Kontrollierter Staging-Aktiv-Launch.",
      confirmation: "AKTIV-LAUNCH STARTEN",
    }),
  "confirmation_required",
);
expectInputError(
  () =>
    parseLaunchCommand({
      blueprintId: "22222222-2222-4222-8222-222222222222",
      brandProfileId: "33333333-3333-4333-8333-333333333333",
      brandAssetId: "44444444-4444-4444-8444-444444444444",
      allowedDomainId: "11111111-1111-4111-8111-111111111111",
      budgetOwnerType: "AD_SET",
      dailyBudget: "20",
      destinationUrl: "http://www.example.de/angebot",
      reason: "Kontrollierter Staging-Aktiv-Launch.",
      confirmation: "AKTIV-LAUNCH VORBEREITEN",
    }),
  "invalid_destination_url",
);
expectInputError(
  () =>
    parseLaunchCommand({
      blueprintId: "22222222-2222-4222-8222-222222222222",
      brandProfileId: "33333333-3333-4333-8333-333333333333",
      brandAssetId: "44444444-4444-4444-8444-444444444444",
      allowedDomainId: "11111111-1111-4111-8111-111111111111",
      budgetOwnerType: "AD_SET",
      dailyBudget: "20",
      destinationUrl: "https://www.example.de/angebot",
      reason: "Kontrollierter Staging-Aktiv-Launch.",
      confirmation: "AKTIV-LAUNCH VORBEREITEN",
      readLeaseToken: "55555555-5555-4555-8555-555555555555",
    }),
  "unknown_field",
);

assert.deepEqual(
  parseLaunchApprovalCommand({
    planId: "66666666-6666-4666-8666-666666666666",
    payloadHash: "a".repeat(64),
    objective: "OUTCOME_TRAFFIC",
    destinationUrl: "https://www.example.de/angebot",
    targetStatus: "ACTIVE",
    budgetOwnerType: "AD_SET",
    dailyBudgetMinor: "2050",
    campaignName: "Sommer",
    adSetName: "Sommer Ad Set",
    creativeName: "Sommer Creative",
    adName: "Sommer Ad",
    reason: "Exakt geprüfter Staging-Aktiv-Launch.",
    confirmation: "AKTIV-LAUNCH FREIGEBEN",
  }),
  {
    planId: "66666666-6666-4666-8666-666666666666",
    payloadHash: "a".repeat(64),
    objective: "OUTCOME_TRAFFIC",
    destinationUrl: "https://www.example.de/angebot",
    targetStatus: "ACTIVE",
    budgetType: "DAILY",
    budgetOwnerType: "AD_SET",
    dailyBudgetMinor: "2050",
    campaignName: "Sommer",
    adSetName: "Sommer Ad Set",
    creativeName: "Sommer Creative",
    adName: "Sommer Ad",
    reason: "Exakt geprüfter Staging-Aktiv-Launch.",
  },
);

assert.deepEqual(
  parseLaunchApprovalCommand({
    planId: "77777777-7777-4777-8777-777777777777",
    payloadHash: "b".repeat(64),
    objective: "OUTCOME_TRAFFIC",
    destinationUrl: "https://www.example.de/angebot",
    targetStatus: "ACTIVE",
    budgetType: "LIFETIME",
    budgetOwnerType: "CAMPAIGN",
    lifetimeBudgetMinor: "1500",
    startTime: "2026-08-03T10:00:00Z",
    endTime: "2026-08-10T10:00:00Z",
    campaignName: "Lifetime Sommer",
    adSetName: "Lifetime Sommer Ad Set",
    creativeName: "Lifetime Sommer Creative",
    adName: "Lifetime Sommer Ad",
    reason: "Exakt geprüfter Lifetime-Staging-Launch.",
    confirmation: "AKTIV-LAUNCH FREIGEBEN",
  }),
  {
    planId: "77777777-7777-4777-8777-777777777777",
    payloadHash: "b".repeat(64),
    objective: "OUTCOME_TRAFFIC",
    destinationUrl: "https://www.example.de/angebot",
    targetStatus: "ACTIVE",
    budgetType: "LIFETIME",
    budgetOwnerType: "CAMPAIGN",
    lifetimeBudgetMinor: "1500",
    startTime: "2026-08-03T10:00:00.000Z",
    endTime: "2026-08-10T10:00:00.000Z",
    campaignName: "Lifetime Sommer",
    adSetName: "Lifetime Sommer Ad Set",
    creativeName: "Lifetime Sommer Creative",
    adName: "Lifetime Sommer Ad",
    reason: "Exakt geprüfter Lifetime-Staging-Launch.",
  },
);
expectInputError(
  () =>
    parseLaunchApprovalCommand({
      planId: "77777777-7777-4777-8777-777777777777",
      payloadHash: "b".repeat(64),
      objective: "OUTCOME_TRAFFIC",
      destinationUrl: "https://www.example.de/angebot",
      targetStatus: "ACTIVE",
      budgetType: "LIFETIME",
      budgetOwnerType: "CAMPAIGN",
      lifetimeBudgetMinor: "1500",
      dailyBudgetMinor: "500",
      startTime: "2026-08-03T10:00:00Z",
      endTime: "2026-08-10T10:00:00Z",
      campaignName: "Lifetime Sommer",
      adSetName: "Lifetime Sommer Ad Set",
      creativeName: "Lifetime Sommer Creative",
      adName: "Lifetime Sommer Ad",
      reason: "Mischbudget darf nicht freigegeben werden.",
      confirmation: "AKTIV-LAUNCH FREIGEBEN",
    }),
  "unknown_field",
);
expectInputError(
  () =>
    parseLaunchApprovalCommand({
      planId: "66666666-6666-4666-8666-666666666666",
      payloadHash: "a".repeat(64),
      objective: "OUTCOME_TRAFFIC",
      destinationUrl: "https://www.example.de/angebot",
      targetStatus: "ACTIVE",
      budgetOwnerType: "AD_SET",
      dailyBudgetMinor: "2050",
      campaignName: "Sommer",
      adSetName: "Sommer Ad Set",
      creativeName: "Sommer Creative",
      adName: "Sommer Ad",
      reason: "Exakt geprüfter Staging-Aktiv-Launch.",
      confirmation: "AKTIV-LAUNCH STARTEN",
    }),
  "confirmation_required",
);
expectInputError(
  () =>
    parseLaunchApprovalCommand({
      planId: "66666666-6666-4666-8666-666666666666",
      payloadHash: "a".repeat(64),
      objective: "OUTCOME_TRAFFIC",
      destinationUrl: "https://www.example.de/angebot",
      targetStatus: "PAUSED",
      budgetOwnerType: "AD_SET",
      dailyBudgetMinor: "2050",
      campaignName: "Sommer",
      adSetName: "Sommer Ad Set",
      creativeName: "Sommer Creative",
      adName: "Sommer Ad",
      reason: "Exakt geprüfter Staging-Aktiv-Launch.",
      confirmation: "AKTIV-LAUNCH FREIGEBEN",
    }),
  "invalid_option",
);

const [
  componentSource,
  scopeComponentSource,
  canaryComponentSource,
  onboardingSource,
  pageSource,
  serviceSource,
  routeHelperSource,
  policyRouteSource,
  instagramRouteSource,
  brandRouteSource,
  killRouteSource,
  scopeRouteSource,
  canaryRouteSource,
  canaryPrepareRouteSource,
  domainRouteSource,
  blueprintRouteSource,
  assetImportRouteSource,
  launchRouteSource,
  migrationSource,
  autonomyMigrationSource,
  scopeMigrationSource,
  canaryMigrationSource,
  operatorCanaryMigrationSource,
  onboardingMigrationSource,
  atomicLaunchMigrationSource,
  metaImportSource,
  storageSource,
] = await Promise.all([
  readFile(path.join(root, "src/components/AutomationControlCenter.tsx"), "utf8"),
  readFile(path.join(root, "src/components/AutomationScopeManager.tsx"), "utf8"),
  readFile(
    path.join(root, "src/components/AutomationBudgetCanaryManager.tsx"),
    "utf8",
  ),
  readFile(path.join(root, "src/components/AutomationOnboardingControls.tsx"), "utf8"),
  readFile(path.join(root, "src/app/dashboard/page.tsx"), "utf8"),
  readFile(path.join(root, "src/lib/meta/customer-control-service.ts"), "utf8"),
  readFile(path.join(root, "src/lib/meta/customer-control-route.ts"), "utf8"),
  readFile(path.join(root, "src/app/api/meta/automation/policy/route.ts"), "utf8"),
  readFile(
    path.join(root, "src/app/api/meta/automation/instagram-selection/route.ts"),
    "utf8",
  ),
  readFile(path.join(root, "src/app/api/meta/automation/brand/route.ts"), "utf8"),
  readFile(path.join(root, "src/app/api/meta/automation/kill-switch/route.ts"), "utf8"),
  readFile(path.join(root, "src/app/api/meta/automation/scope/route.ts"), "utf8"),
  readFile(
    path.join(root, "src/app/api/meta/automation/budget-canary/route.ts"),
    "utf8",
  ),
  readFile(
    path.join(
      root,
      "src/app/api/meta/automation/budget-canary/prepare/route.ts",
    ),
    "utf8",
  ),
  readFile(path.join(root, "src/app/api/meta/automation/domain/route.ts"), "utf8"),
  readFile(path.join(root, "src/app/api/meta/automation/blueprint/route.ts"), "utf8"),
  readFile(path.join(root, "src/app/api/meta/automation/asset-import/route.ts"), "utf8"),
  readFile(path.join(root, "src/app/api/meta/automation/launch/route.ts"), "utf8"),
  readFile(
    path.join(
      root,
      "supabase/migrations/20260729240000_meta_customer_controls.sql",
    ),
    "utf8",
  ),
  readFile(
    path.join(
      root,
      "supabase/migrations/20260804153000_meta_customer_budget_autonomy.sql",
    ),
    "utf8",
  ),
  readFile(
    path.join(
      root,
      "supabase/migrations/20260801100000_meta_customer_campaign_scope.sql",
    ),
    "utf8",
  ),
  readFile(
    path.join(
      root,
      "supabase/migrations/20260801110000_meta_budget_canary_confirmation.sql",
    ),
    "utf8",
  ),
  readFile(
    path.join(
      root,
      "supabase/migrations/20260801120000_meta_operator_budget_canary.sql",
    ),
    "utf8",
  ),
  readFile(
    path.join(
      root,
      "supabase/migrations/20260729250000_meta_customer_onboarding.sql",
    ),
    "utf8",
  ),
  readFile(
    path.join(
      root,
      "supabase/migrations/20260802150000_meta_atomic_launch_canary.sql",
    ),
    "utf8",
  ),
  readFile(path.join(root, "src/lib/creative-assets/meta-import.ts"), "utf8"),
  readFile(path.join(root, "src/lib/creative-assets/storage.ts"), "utf8"),
]);

assert.match(serviceSource, /import "server-only";/);
assert.match(serviceSource, /authenticateMetaCustomer/);
assert.match(serviceSource, /createAdminClient/);
assert.match(serviceSource, /meta_scopes/);
assert.match(serviceSource, /command\.enableAutomation && !customer\.writeScopeGranted/);
assert.match(serviceSource, /command\.mode === "ALLOW" && !customer\.writeScopeGranted/);
assert.match(serviceSource, /\.eq\("user_id", customer\.userId\)/);
assert.match(routeHelperSource, /origin !== request\.nextUrl\.origin/);
assert.match(routeHelperSource, /MAX_BODY_BYTES/);
assert.match(routeHelperSource, /private, no-store/);
assert.match(policyRouteSource, /parsePolicyCommand/);
assert.match(policyRouteSource, /managedBudgetOwnerCount/);
assert.match(instagramRouteSource, /selection_managed_by_meta/);
assert.match(instagramRouteSource, /\b410\b/);
assert.doesNotMatch(
  instagramRouteSource,
  /parseInstagramSelectionCommand|saveCustomerInstagramSelection/,
);
assert.match(brandRouteSource, /parseBrandCommand/);
assert.match(killRouteSource, /parseKillSwitchCommand/);
assert.match(scopeRouteSource, /parseAutomationScopeCommand/);
assert.match(scopeRouteSource, /setCustomerAutomationScope/);
assert.match(canaryRouteSource, /parseBudgetCanaryApprovalCommand/);
assert.match(canaryRouteSource, /approveCustomerBudgetCanary/);
assert.match(canaryRouteSource, /readControlJson/);
assert.match(canaryPrepareRouteSource, /parseBudgetCanaryMaterializationCommand/);
assert.match(canaryPrepareRouteSource, /materializeCustomerBudgetCanary/);
assert.match(canaryPrepareRouteSource, /readControlJson/);
assert.match(domainRouteSource, /parseDomainCommand/);
assert.match(domainRouteSource, /applyCustomerDomainCommand/);
assert.match(blueprintRouteSource, /parseBlueprintCommand/);
assert.match(blueprintRouteSource, /applyCustomerBlueprintCommand/);
assert.match(assetImportRouteSource, /parseAssetImportCommand/);
assert.match(assetImportRouteSource, /importCustomerBrandAsset/);
assert.match(launchRouteSource, /export async function POST/);
assert.match(launchRouteSource, /parseLaunchCommand/);
assert.match(launchRouteSource, /materializeCustomerLaunch/);
assert.match(launchRouteSource, /export async function PUT/);
assert.match(launchRouteSource, /parseLaunchApprovalCommand/);
assert.match(launchRouteSource, /approveCustomerLaunch/);
assert.match(pageSource, /AutomationControlCenter/);
assert.match(pageSource, /instagram_account_ids/);
assert.match(pageSource, /meta_asset_id/);
assert.match(pageSource, /meta_scopes\.includes\("ads_management"\)/);
assert.match(pageSource, /writeScopeGranted/);
assert.match(pageSource, /\.eq\("is_current", true\)/);
assert.match(pageSource, /daily_budget_exposure_snapshots/);
assert.match(pageSource, /\.from\("automation_targets"\)/);
assert.match(pageSource, /automationScope=\{automationScopeView\}/);
assert.match(pageSource, /list_meta_budget_canary_plans/);
assert.match(pageSource, /budgetCanaries=\{budgetCanaryViews\}/);
assert.match(pageSource, /canPrepareBudgetCanary=\{canPrepareBudgetCanary\}/);
assert.match(pageSource, /canConfirmBudgetCanary=\{canConfirmBudgetCanary\}/);
assert.match(
  pageSource,
  /const canPrepareBudgetCanary[\s\S]*?killSwitchView\?\.mode === "FREEZE_WRITES"[\s\S]*?const canConfirmBudgetCanary/,
);
assert.match(
  pageSource,
  /const canConfirmBudgetCanary[\s\S]*?killSwitchView\?\.mode === "ALLOW"[\s\S]*?const campaignNameById/,
);
assert.match(pageSource, /managedBudgetOwnerCount === 1/);
assert.match(pageSource, /!policyView\.allowStatusChanges/);
assert.match(pageSource, /!policyView\.allowNewLaunches/);
assert.match(pageSource, /source_marketing_sync_id/);
assert.match(pageSource, /\.eq\("user_id", user\.id\)/);
assert.match(pageSource, /\.eq\("platform_account_id", metaAccount\.id\)/);
assert.match(pageSource, /list_current_meta_creatives_for_import/);
assert.match(pageSource, /id,status,created_at,payload_hash,planned_payload/);
assert.match(pageSource, /payloadHash/);
assert.match(pageSource, /brandAssetIds/);
assert.doesNotMatch(
  pageSource,
  /\.from\("creatives"\)[\s\S]{0,200}\.select\([^)]*content/,
);
assert.match(componentSource, /\/api\/meta\/automation\/policy/);
assert.match(componentSource, /Grenzen bestätigen und Autonomie starten/);
assert.doesNotMatch(
  componentSource,
  /InstagramProfileSelector|instagram-selection/,
);
assert.match(componentSource, /\/api\/meta\/automation\/brand/);
assert.match(componentSource, /\/api\/meta\/automation\/kill-switch/);
assert.match(componentSource, /Max\. 20 % \/ 24 h/);
assert.match(componentSource, /12 h Cooldown/);
assert.match(componentSource, /Minimaler Meta-Schreibscope fehlt/);
assert.match(componentSource, /Meta sicher neu verbinden/);
assert.match(componentSource, /AutomationScopeManager/);
assert.match(componentSource, /AutomationBudgetCanaryManager/);
assert.match(scopeComponentSource, /\/api\/meta\/automation\/scope/);
assert.match(scopeComponentSource, /window\.confirm/);
assert.match(scopeComponentSource, /Sobald du die Budgetautomatik gestartet hast/);
assert.match(scopeComponentSource, /Automatische Budgetanpassungen sind noch nicht aktiviert/);
assert.match(scopeComponentSource, /Grenzen bestätigen und Autonomie starten/);
assert.doesNotMatch(
  scopeComponentSource,
  /Budget-Autonomie ist deaktiviert|aktive EUR-Policy|ads_management|sicher suspendiert|Budgetowner|Budgetplanner/,
);
assert.match(canaryComponentSource, /\/api\/meta\/automation\/budget-canary\/prepare/);
assert.match(canaryComponentSource, /\/api\/meta\/automation\/budget-canary/);
assert.match(canaryComponentSource, /window\.confirm/);
assert.match(canaryComponentSource, /CANARY VORBEREITEN/);
assert.match(canaryComponentSource, /sendet noch nichts an Meta/);
assert.match(canaryComponentSource, /BUDGET ÄNDERN/);
assert.match(canaryComponentSource, /Reale Meta-Änderung/);
assert.match(canaryComponentSource, /Exakt diesen Budgetplan freigeben/);
assert.doesNotMatch(canaryComponentSource, /Date\.now|\/api\/cron\/meta-executor/);
assert.match(componentSource, /mode === "ALLOW" && !readiness\.writeScopeGranted/);
assert.match(onboardingSource, /\/api\/meta\/automation\/domain/);
assert.match(onboardingSource, /\/api\/meta\/automation\/blueprint/);
assert.match(onboardingSource, /\/api\/meta\/automation\/asset-import/);
assert.match(onboardingSource, /\/api\/meta\/automation\/launch/);
assert.match(onboardingSource, /Kill-Switch FREEZE_WRITES/);
assert.match(onboardingSource, /Aktueller Exposure-Snapshot/);
assert.match(onboardingSource, /AKTIV-LAUNCH VORBEREITEN/);
assert.match(onboardingSource, /AKTIV-LAUNCH FREIGEBEN/);
assert.match(onboardingSource, /Unveränderlicher Aktiv-Launch · HELD/);
assert.match(onboardingSource, /Noch 0 Meta-Writes/);
assert.match(onboardingSource, /SHA-256-Fingerprint/);
assert.match(onboardingSource, /Exakt diesen Aktiv-Launch freigeben/);
assert.doesNotMatch(onboardingSource, /\/api\/cron\/meta-executor|Date\.now/);
assert.doesNotMatch(
  componentSource,
  /SUPABASE_SERVICE_ROLE_KEY|createAdminClient|platformAccountId|access_token/i,
);
assert.doesNotMatch(
  onboardingSource,
  /SUPABASE_SERVICE_ROLE_KEY|createAdminClient|platformAccountId|access_token|read_lease/i,
);
assert.doesNotMatch(
  scopeComponentSource,
  /SUPABASE_SERVICE_ROLE_KEY|createAdminClient|platformAccountId|access_token|read_lease/i,
);
assert.doesNotMatch(
  instagramRouteSource,
  /SUPABASE_SERVICE_ROLE_KEY|createAdminClient|platformAccountId|access_token|read_lease/i,
);
assert.doesNotMatch(
  canaryComponentSource,
  /SUPABASE_SERVICE_ROLE_KEY|createAdminClient|platformAccountId|access_token|read_lease|accessToken/i,
);
assert.match(serviceSource, /requireWriteReadyCustomer/);
assert.match(serviceSource, /materialize_meta_customer_launch_plan/);
assert.match(serviceSource, /customer-launch-prepare:/);
assert.match(serviceSource, /approve_meta_launch_canary_plan/);
assert.match(serviceSource, /p_expected_payload_hash: command\.payloadHash/);
assert.match(serviceSource, /put_meta_customer_budget_autonomy_policy/);
assert.match(serviceSource, /function firstRpcRow/);
assert.match(serviceSource, /Details:/);
assert.match(
  await readFile(
    path.join(root, "supabase/migrations/20260808150000_policy_save_revive_nonfatal.sql"),
    "utf8",
  ),
  /Soft-fail: hard-cap \/ policy changes must still persist/,
);
assert.match(serviceSource, /\.from\("meta_assets"\)/);
assert.match(serviceSource, /set_meta_customer_automation_scope/);
assert.match(serviceSource, /command\.status === "MANAGED"/);
assert.match(serviceSource, /materialize_meta_customer_budget_canary_plan/);
assert.match(serviceSource, /p_read_lease_token: leaseToken/);
assert.match(serviceSource, /customer-budget-canary:/);
assert.match(serviceSource, /approve_meta_budget_canary_plan/);
assert.match(serviceSource, /p_expected_payload_hash: command\.payloadHash/);
assert.match(serviceSource, /p_expected_before_minor: command\.currentBudgetMinor/);
assert.match(serviceSource, /p_intended_after_minor: command\.intendedBudgetMinor/);
assert.match(serviceSource, /claimMetaReadOperation/);
assert.match(serviceSource, /releaseMetaAccountOperation/);
assert.match(serviceSource, /\.eq\("platform_creative_id", command\.sourceCreativeId\)/);
assert.match(serviceSource, /\.eq\("source", "meta"\)/);
assert.match(serviceSource, /\.eq\("last_seen_sync_id", customer\.marketingSyncId\)/);
assert.match(serviceSource, /p_source_marketing_sync_id: customer\.marketingSyncId/);
assert.match(serviceSource, /fresh_marketing_sync_required/);
assert.match(serviceSource, /importMetaCreativeImage/);
assert.doesNotMatch(serviceSource, /p_read_lease_token:\s*command/i);
assert.match(metaImportSource, /META_CDN_SUFFIXES/);
assert.match(metaImportSource, /redirect: "manual"/);
assert.match(metaImportSource, /MAX_CREATIVE_IMAGE_BYTES/);
assert.match(metaImportSource, /inspectCreativeImage/);
assert.match(storageSource, /public: false/);
assert.match(storageSource, /input\.userId/);
assert.match(storageSource, /input\.platformAccountId/);
assert.match(migrationSource, /budget_change_limit_bps[\s\S]*2000/);
assert.match(migrationSource, /cooldown_seconds[\s\S]*43200/);
assert.match(migrationSource, /marketing_currency = 'EUR'/);
assert.match(
  migrationSource,
  /p_enable_automation[\s\S]*'ads_management' = any\(pa\.meta_scopes\)/,
);
assert.match(
  migrationSource,
  /p_mode = 'ALLOW'[\s\S]*'ads_management' = any\(pa\.meta_scopes\)/,
);
assert.match(
  migrationSource,
  /revoke all on function public\.put_meta_customer_policy_version/,
);
assert.match(
  migrationSource,
  /grant execute on function public\.set_meta_customer_kill_switch[\s\S]*to service_role/,
);
assert.doesNotMatch(
  migrationSource,
  /grant execute on function public\.(put_meta_customer_policy_version|set_meta_customer_kill_switch)[\s\S]*to authenticated/,
);
assert.match(autonomyMigrationSource, /put_meta_customer_budget_autonomy_policy/);
assert.match(autonomyMigrationSource, /set_meta_customer_budget_autonomy/);
assert.match(autonomyMigrationSource, /policy\.budget_change_limit_bps = 2000/);
assert.match(autonomyMigrationSource, /policy\.cooldown_seconds = 43200/);
assert.match(autonomyMigrationSource, /selection\.status = 'SUSPENDED'/);
assert.match(autonomyMigrationSource, /then 'MANAGED'/);
assert.match(autonomyMigrationSource, /'ALLOW'/);
assert.match(autonomyMigrationSource, /'FREEZE_WRITES'/);
assert.match(
  autonomyMigrationSource,
  /grant execute on function public\.put_meta_customer_budget_autonomy_policy[\s\S]*to service_role/,
);
assert.doesNotMatch(
  autonomyMigrationSource,
  /grant execute on function public\.put_meta_customer_budget_autonomy_policy[\s\S]{0,180}to authenticated/,
);
assert.match(scopeMigrationSource, /create table public\.automation_scope_selections/);
assert.match(scopeMigrationSource, /update public\.automation_targets[\s\S]*status = 'SUSPENDED'/);
assert.match(scopeMigrationSource, /'ads_management' = any\(account\.meta_scopes\)/);
assert.match(scopeMigrationSource, /AUTOMATION_SCOPE_CHANGED/);
assert.match(
  scopeMigrationSource,
  /revoke all on function public\.set_meta_customer_automation_scope[\s\S]*from public, anon, authenticated/,
);
assert.match(
  scopeMigrationSource,
  /grant execute on function public\.set_meta_customer_automation_scope[\s\S]*to service_role/,
);
assert.doesNotMatch(
  scopeMigrationSource,
  /grant execute on function public\.set_meta_customer_automation_scope[\s\S]*to authenticated/,
);
assert.match(operatorCanaryMigrationSource, /materialize_meta_customer_budget_canary_plan/);
assert.match(
  operatorCanaryMigrationSource,
  /v_intended_budget :=[\s\S]*\(v_current_budget \* 9000 \+ 9999\) \/ 10000/,
);
assert.match(operatorCanaryMigrationSource, /'change_bps', 1000/);
assert.match(operatorCanaryMigrationSource, /'direction', 'DECREASE'/);
assert.match(operatorCanaryMigrationSource, /v_managed_budget_owner_count <> 1/);
assert.match(operatorCanaryMigrationSource, /lease_kind = 'READ_SYNC'/);
assert.match(operatorCanaryMigrationSource, /snapshot\.status = 'COMPLETE'/);
assert.match(
  operatorCanaryMigrationSource,
  /coalesce\(v_kill_mode, 'FREEZE_WRITES'\) <> 'ALLOW'/,
);
assert.match(operatorCanaryMigrationSource, /not_before[\s\S]*'infinity'::timestamptz/);
assert.match(operatorCanaryMigrationSource, /max_attempts[\s\S]*1/);
assert.match(operatorCanaryMigrationSource, /BUDGET_CANARY_PLAN_MATERIALIZED/);
assert.match(
  operatorCanaryMigrationSource,
  /grant execute on function public\.materialize_meta_customer_budget_canary_plan[\s\S]*to service_role/,
);
assert.doesNotMatch(
  operatorCanaryMigrationSource,
  /grant execute on function public\.materialize_meta_customer_budget_canary_plan[\s\S]{0,160}to authenticated/,
);
assert.match(canaryMigrationSource, /create table public\.meta_budget_canary_approvals/);
assert.match(canaryMigrationSource, /not_before = 'infinity'::timestamptz/);
assert.match(canaryMigrationSource, /BUDGET_CANARY_CONFIRMATION_REQUIRED/);
assert.match(canaryMigrationSource, /BUDGET_CANARY_PLAN_APPROVED/);
assert.match(canaryMigrationSource, /p_expected_payload_hash/);
assert.match(canaryMigrationSource, /v_managed_budget_owner_count <> 1/);
assert.match(canaryMigrationSource, /fresh_sync boolean/);
assert.match(canaryMigrationSource, /is_expired boolean/);
assert.match(
  canaryMigrationSource,
  /grant execute on function public\.list_meta_budget_canary_plans[\s\S]*to authenticated/,
);
assert.match(
  canaryMigrationSource,
  /grant execute on function public\.approve_meta_budget_canary_plan[\s\S]*to service_role/,
);
assert.doesNotMatch(
  canaryMigrationSource,
  /grant execute on function public\.approve_meta_budget_canary_plan[\s\S]{0,120}to authenticated/,
);
assert.match(onboardingMigrationSource, /register_meta_allowed_domain/);
assert.match(onboardingMigrationSource, /confirm_meta_allowed_domain/);
assert.match(onboardingMigrationSource, /put_meta_objective_blueprint/);
assert.match(onboardingMigrationSource, /activate_meta_objective_blueprint/);
assert.match(onboardingMigrationSource, /import_meta_brand_asset_from_creative/);
assert.match(onboardingMigrationSource, /list_current_meta_creatives_for_import/);
assert.match(onboardingMigrationSource, /materialize_meta_customer_launch_plan/);
assert.match(
  onboardingMigrationSource,
  /pa\.marketing_sync_id = p_source_marketing_sync_id/,
);
assert.match(
  onboardingMigrationSource,
  /creative\.source = 'meta'[\s\S]*creative\.is_current[\s\S]*creative\.last_seen_sync_id = p_source_marketing_sync_id/,
);
assert.match(
  onboardingMigrationSource,
  /v_user_id uuid := auth\.uid\(\)[\s\S]*list_current_meta_creatives_for_import|list_current_meta_creatives_for_import[\s\S]*v_user_id uuid := auth\.uid\(\)/,
);
assert.match(
  onboardingMigrationSource,
  /marketing_currency = 'EUR'[\s\S]*'ads_management' = any\(pa\.meta_scopes\)/,
);
assert.match(
  onboardingMigrationSource,
  /source_marketing_sync_id = v_account\.marketing_sync_id/,
);
assert.match(
  onboardingMigrationSource,
  /v_destination_host is null or v_destination_host <> v_domain\.hostname/,
);
assert.match(
  onboardingMigrationSource,
  /public\.materialize_meta_launch_chain_plan/,
);
assert.match(atomicLaunchMigrationSource, /CUSTOMER_LAUNCH_PREPARED/);
assert.match(atomicLaunchMigrationSource, /LAUNCH_CANARY_PLAN_APPROVED/);
assert.match(onboardingMigrationSource, /BRAND_ASSET_IMPORTED_FROM_META/);
assert.match(
  onboardingMigrationSource,
  /revoke all on function public\.materialize_meta_customer_launch_plan[\s\S]*from public, anon, authenticated/,
);
assert.match(
  onboardingMigrationSource,
  /grant execute on function public\.list_current_meta_creatives_for_import[\s\S]*to authenticated/,
);
assert.match(
  onboardingMigrationSource,
  /grant execute on function public\.materialize_meta_customer_launch_plan[\s\S]*to service_role/,
);
assert.doesNotMatch(
  onboardingMigrationSource,
  /grant execute on function public\.list_current_meta_creatives_for_import[\s\S]{0,80}to (?:anon|service_role)/,
);
assert.doesNotMatch(
  onboardingMigrationSource,
  /grant execute on function public\.(register_meta_allowed_domain|confirm_meta_allowed_domain|put_meta_objective_blueprint|activate_meta_objective_blueprint|import_meta_brand_asset_from_creative|materialize_meta_customer_launch_plan)\([^;]*\)\s*to authenticated;/,
);
assert.match(atomicLaunchMigrationSource, /create table public\.meta_launch_canary_approvals/);
assert.match(atomicLaunchMigrationSource, /not_before\s*:=\s*'infinity'::timestamptz/);
assert.match(atomicLaunchMigrationSource, /max_attempts\s*:=\s*1/);
assert.match(atomicLaunchMigrationSource, /p_expected_payload_hash/);
assert.match(atomicLaunchMigrationSource, /p_expected_destination_url/);
assert.match(atomicLaunchMigrationSource, /p_expected_daily_budget_minor/);
assert.match(atomicLaunchMigrationSource, /account\.marketing_sync_id = plan\.source_marketing_sync_id/);
assert.match(atomicLaunchMigrationSource, /public\.meta_sha256\(plan\.planned_payload::text\) = plan\.payload_hash/);
assert.match(atomicLaunchMigrationSource, /meta_launch_canary_preflight_ok/);
assert.match(atomicLaunchMigrationSource, /meta_launch_activation_barrier_ok/);
assert.match(atomicLaunchMigrationSource, /dispatch_state = 'REMOTE_UNKNOWN'/);
assert.match(atomicLaunchMigrationSource, /COMPENSATION_REQUIRED/);
assert.match(atomicLaunchMigrationSource, /append_meta_kill_switch_state\([\s\S]*?'ACCOUNT'[\s\S]*?'FREEZE_WRITES'/);
assert.match(atomicLaunchMigrationSource, /append_meta_kill_switch_state\([\s\S]*?'PLAN'[\s\S]*?'FREEZE_WRITES'/);
assert.match(atomicLaunchMigrationSource, /'status', 'PAUSED'/);
assert.match(atomicLaunchMigrationSource, /'status', 'ACTIVE'/);
assert.match(
  atomicLaunchMigrationSource,
  /grant execute on function public\.approve_meta_launch_canary_plan[\s\S]*to service_role/,
);
assert.doesNotMatch(
  atomicLaunchMigrationSource,
  /grant execute on function public\.approve_meta_launch_canary_plan[\s\S]{0,160}to authenticated/,
);

console.log("Meta customer control validation, API boundary and dashboard checks passed");
