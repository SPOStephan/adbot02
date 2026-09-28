import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const page = read("src/app/dashboard/traffic-launch/page.tsx");
assert.match(page, /resolvePublicFunnelPurposeHint\(initialFunnelUrl\)/);
assert.match(page, /!initialFunnelUrl \|\| funnelTrafficMode \? \(/);
assert.match(page, /MetaPixelBinding pixels=\{onboardingData\.pixels\}/);
assert.match(page, /Meta jetzt verbinden/);
assert.match(page, /adAccountPickerOptions/);
assert.match(page, /adAccounts=\{adAccountPickerOptions\}/);
assert.doesNotMatch(page, /LiveSetupChecklist/);

const hints = read("src/lib/funnel-purpose-hints.ts");
assert.match(hints, /metaTracking: \{/);
assert.match(hints, /enabled: metaTracking\?\.enabled === true/);
assert.match(hints, /pixelId: typeof metaTracking\?\.pixelId === "string"/);

const lead = read("src/components/LeadLaunchCanary.tsx");
assert.match(lead, /initialFunnelIndex >= 0/);
assert.match(lead, /action: "probe"/);
assert.match(lead, /Conversions API jetzt prüfen/);
assert.match(lead, /MetaAdAccountPicker accounts=\{adAccounts\} compact/);
assert.match(lead, /Aktives Werbekonto für diese Prüfung/);
assert.match(lead, /needsAdAccountSelection/);
assert.match(lead, /Zuerst Werbekonto wählen/);
assert.match(lead, /Funnel-Tracking synchronisieren/);
assert.doesNotMatch(lead, /Kampagnenstart jetzt freigeben/);
assert.match(lead, /\/api\/meta\/automation\/launch-policy/);
assert.match(lead, /await ensureCampaignLaunchPolicy\(\)/);
assert.equal((lead.match(/Entwurf sichern/g) ?? []).length, 2);
assert.match(lead, /Automatische Zielgruppenfindung durch Meta/);
assert.match(lead, /Werbemittel wählen oder hochladen/);
assert.match(lead, />\s*Kampagnenname\s*</);
assert.match(lead, /campaignNameOverride \?\? suggestedCampaignName/);
assert.match(lead, /campaignName,\s*\n\s*adSetName:/);
assert.match(lead, /multiSelect/);
assert.match(lead, /selectedAssetIds=\{pickerSelectedAssetIds\}/);
assert.match(lead, /selectedFunnelCustomHostname/);
assert.match(lead, /Custom Domain des ausgewählten Funnels/);
assert.match(lead, /selectedHostname !== sharedHostname/);
assert.match(lead, /<MetaAdPreviewGallery/);
assert.match(lead, /buildMetaAdPreviewCombinations\(\{/);
assert.match(lead, /onSubmit=\{showAdPreview\}/);
assert.match(lead, /Kampagne jetzt starten/);
assert.match(lead, /void startCampaign\(\)/);
assert.match(lead, /kein Budget reserviert und nichts an Meta übertragen/);
const localPreviewFlow = lead.slice(
  lead.indexOf("function showAdPreview"),
  lead.indexOf("async function startCampaign"),
);
assert.ok(localPreviewFlow.length > 0);
assert.doesNotMatch(localPreviewFlow, /\/api\/meta\/automation\/launch/);
assert.doesNotMatch(localPreviewFlow, /ensureCampaignLaunchPolicy/);
assert.doesNotMatch(lead, /alt="Werbemittel-Vorschau"/);
assert.doesNotMatch(lead, />\s*Lead Canary\s*</);
assert.doesNotMatch(lead, />\s*Struktur-Test\s*</);
assert.match(lead, /Kampagne an Meta übermittelt und aktiviert/);

const traffic = read("src/components/TrafficLaunchCanary.tsx");
assert.match(traffic, /optimization_goal: "LANDING_PAGE_VIEWS"/);
assert.match(traffic, /Traffic \(Landingpage-Aufrufe\)/);

const launchPage = read("src/app/dashboard/traffic-launch/page.tsx");
assert.match(launchPage, /query\.campaignGoal === "landing-page-views"/);
assert.match(launchPage, /funnelTrafficMode\s*\?\s*initialFunnelUrl/);

const funnelLibrary = read("apps/adbot-funnel/client/src/pages/admin/FunnelLibrary.tsx");
assert.match(funnelLibrary, /Lead-Kampagne bei Meta aktiv/);
assert.match(funnelLibrary, /Zusätzlich für Landingpage-Aufrufe bewerben/);
assert.match(funnelLibrary, /campaignStatusesQuery/);

const campaignStatusRoute = read("src/app/api/internal/funnel-campaign-status/route.ts");
assert.match(campaignStatusRoute, /\.eq\("source_rule_key", "active-launch-chain"\)/);
assert.match(campaignStatusRoute, /\.eq\("status", "SUCCEEDED"\)/);
assert.match(campaignStatusRoute, /campaign\.status === "ACTIVE" && campaign\.effective_status === "ACTIVE"/);

const adPreview = read("src/components/MetaAdPreviewGallery.tsx");
assert.match(adPreview, /Meta-Anzeigenvorschau/);
assert.match(adPreview, /Gesponsert/);
assert.match(adPreview, /genau ein Motiv, einen Primary Text und eine Headline/);
assert.match(adPreview, /repräsentative mögliche Kombinationen/);
assert.match(adPreview, /\/api\/media-library\/preview\?assetId=/);
assert.match(adPreview, /von \$\{total\} möglichen Kombinationen/);

const dashboardLoader = read("src/lib/dashboard/load-customer-dashboard.ts");
assert.match(dashboardLoader, /creative\?\.asset_feed_spec/);
assert.match(dashboardLoader, /copyVariants\("bodies"\)/);
assert.match(dashboardLoader, /copyVariants\("titles"\)/);
assert.match(dashboardLoader, /copyVariants\("descriptions"\)/);

const picker = read("src/components/CreativePickerModal.tsx");
assert.match(picker, /multiple=\{multiSelect\}/);
assert.match(picker, /onSelectionChange/);
assert.match(picker, /maxSelected = MAX_DYNAMIC_CREATIVE_IMAGES/);
assert.match(picker, /Bis zu zehn Motive hochladen/);

const service = read("src/lib/meta/customer-control-service.ts");
assert.match(service, /capi_probe_status: probed\.status/);
assert.match(service, /\.eq\("pixel_id", probed\.pixelId\)/);
assert.match(service, /pushSoftMetaPixelToFunnel\(\{/);
assert.match(service, /customEventType: updatedPixel\.custom_event_type/);
assert.match(service, /options\.triggerOrganicBoost !== false/);

const launchPolicyRoute = read(
  "src/app/api/meta/automation/launch-policy/route.ts",
);
assert.match(launchPolicyRoute, /parsePolicyCommand/);
assert.match(launchPolicyRoute, /triggerOrganicBoost: false/);

const pageCopy = read("src/lib/dashboard/page-copy.ts");
assert.match(pageCopy, /title: "Meta-Kampagnen starten"/);
assert.doesNotMatch(pageCopy, /Traffic- und Lead-Canaries/);

const navigation = read("src/lib/dashboard/navigation.ts");
assert.match(navigation, /label: "Kampagne starten"/);

const guide = read("src/lib/help/lead-funnel-setup.ts");
assert.match(guide, /title: "Funnel mit Meta bewerben"/);
assert.match(guide, /QualifiedLead/);
assert.doesNotMatch(guide, /Erster Live-Test|Lead-Canary|Traffic-Canary|Testbewerbung/);

console.log("funnel-campaign-launch: ok");
