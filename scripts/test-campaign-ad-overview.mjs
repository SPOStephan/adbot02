import assert from "node:assert/strict";

import { buildMetaAdPreviewCombinations } from "../src/lib/meta/ad-preview-combinations.ts";
import {
  buildCampaignAdOverview,
  campaignLifecycle,
  classifyCampaignKind,
  filterFunnelCampaigns,
  friendlyCampaignName,
} from "../src/lib/meta/campaign-ad-overview.ts";

const NOW = Date.parse("2026-09-29T08:00:00Z");
const ASSET_A = "11111111-1111-4111-8111-111111111111";
const ASSET_B = "22222222-2222-4222-8222-222222222222";

// Kind
assert.equal(classifyCampaignKind({ objective: "OUTCOME_LEADS", name: "x", isOrganicBoost: false }), "lead");
assert.equal(classifyCampaignKind({ objective: "LEAD_GENERATION", name: "x", isOrganicBoost: false }), "lead");
assert.equal(classifyCampaignKind({ objective: "OUTCOME_TRAFFIC", name: "x", isOrganicBoost: false }), "traffic");
assert.equal(classifyCampaignKind({ objective: "OUTCOME_ENGAGEMENT", name: "Organic Boost 12", isOrganicBoost: false }), "boost");
assert.equal(classifyCampaignKind({ objective: "OUTCOME_TRAFFIC", name: "x", isOrganicBoost: true }), "boost");
assert.equal(classifyCampaignKind({ objective: "OUTCOME_SALES", name: "x", isOrganicBoost: false }), "other");
assert.equal(classifyCampaignKind({ objective: null, name: "x", isOrganicBoost: false }), "other");

// Lifecycle
const life = (status, effectiveStatus, stopTime = null) =>
  campaignLifecycle({ status, effectiveStatus, stopTime, now: NOW });
assert.deepEqual(life("ACTIVE", "ACTIVE"), { lifecycle: "active", statusLabel: "Aktiv" });
assert.deepEqual(life("ACTIVE", "IN_PROCESS"), { lifecycle: "active", statusLabel: "In Prüfung" });
assert.equal(life("PAUSED", "PAUSED").lifecycle, "archived");
assert.equal(life("ACTIVE", "CAMPAIGN_PAUSED").statusLabel, "Pausiert");
assert.equal(life("ACTIVE", "ACTIVE", "2026-09-01T00:00:00Z").statusLabel, "Beendet");
assert.equal(life("ACTIVE", "ACTIVE", "2026-10-30T00:00:00Z").lifecycle, "active");
assert.equal(life("ARCHIVED", "ARCHIVED").statusLabel, "Archiviert");

assert.equal(friendlyCampaignName("Funnel Leads [0a1b2c3d-aaaa]"), "Funnel Leads");

// Full build
const items = buildCampaignAdOverview({
  campaigns: [
    { id: "c-lead", platform_campaign_id: "p-lead", name: "Lead Funnel", objective: "OUTCOME_LEADS", status: "ACTIVE", effective_status: "ACTIVE", daily_budget_minor: 2000 },
    { id: "c-traffic", platform_campaign_id: "p-traffic", name: "Traffic", objective: "OUTCOME_TRAFFIC", status: "ACTIVE", effective_status: "ACTIVE" },
    { id: "c-boost", platform_campaign_id: "p-boost", name: "Organic Boost 1", objective: "OUTCOME_ENGAGEMENT", status: "PAUSED", effective_status: "PAUSED" },
    { id: "c-ext", platform_campaign_id: "p-ext", name: "Manuell", objective: "OUTCOME_SALES", status: "ACTIVE", effective_status: "ACTIVE" },
  ],
  adGroups: [
    { id: "g-lead", campaign_id: "c-lead" },
    { id: "g-traffic", campaign_id: "c-traffic" },
    { id: "g-boost", campaign_id: "c-boost" },
    { id: "g-ext", campaign_id: "c-ext" },
  ],
  ads: [
    { id: "a-lead", ad_group_id: "g-lead", platform_ad_id: "1", status: "ACTIVE", effective_status: "ACTIVE", platform_creative_id: "cr-lead" },
    { id: "a-t1", ad_group_id: "g-traffic", platform_ad_id: "1", status: "ACTIVE", effective_status: "ACTIVE", platform_creative_id: "cr-t1" },
    { id: "a-t2", ad_group_id: "g-traffic", platform_ad_id: "2", status: "ACTIVE", effective_status: "ACTIVE", platform_creative_id: "cr-t2" },
    { id: "a-boost", ad_group_id: "g-boost", platform_ad_id: "1", status: "PAUSED", effective_status: "PAUSED", platform_creative_id: "cr-boost" },
    { id: "a-ext", ad_group_id: "g-ext", platform_ad_id: "1", status: "ACTIVE", effective_status: "ACTIVE", platform_creative_id: "cr-ext" },
  ],
  creatives: [
    { platform_creative_id: "cr-lead", thumbnail_url: "https://cdn.example/lead-thumb.jpg" },
    { platform_creative_id: "cr-t1", title: "Headline 1", body: "Text 1", call_to_action_type: "SIGN_UP", content: { image_url: "https://cdn.example/t1.jpg" } },
    { platform_creative_id: "cr-t2", title: "Headline 2", body: "Text 2" },
    { platform_creative_id: "cr-boost", thumbnail_url: "https://cdn.example/post.jpg", instagram_permalink_url: "https://instagram.com/p/x" },
    { platform_creative_id: "cr-ext", title: "Kauf", body: "Jetzt kaufen", content: { image_url: "https://cdn.example/ext.jpg" } },
  ],
  plans: [
    {
      id: "plan-lead",
      source_rule_key: "active-launch-chain",
      planned_payload: {
        destination_url: "https://funnel.example/start/",
        brand_asset_ids: [ASSET_A, ASSET_B],
        creative: {
          asset_feed_spec: {
            bodies: [{ text: "Body A" }, { text: "Body B" }],
            titles: [{ text: "Titel A" }],
            call_to_action_types: ["APPLY_NOW"],
          },
        },
      },
    },
    {
      id: "plan-traffic",
      source_rule_key: "active-launch-chain",
      planned_payload: {
        destination_url: "https://funnel.example/start",
        variant_destination_url: "https://funnel.example/b",
        creatives: [
          { object_story_spec: { link_data: { message: "Plan 1", name: "Plan H1" } } },
          { object_story_spec: { link_data: { message: "Plan 2", name: "Plan H2", description: "Beschreibung 2" } } },
        ],
      },
    },
    { id: "plan-boost", source_rule_key: "organic-boost", planned_payload: {} },
  ],
  campaignBindings: [
    { plan_id: "plan-lead", local_campaign_id: "c-lead", remote_object_id: "p-lead" },
    { plan_id: "plan-traffic", local_campaign_id: null, remote_object_id: "p-traffic" },
    { plan_id: "plan-boost", local_campaign_id: "c-boost", remote_object_id: "p-boost" },
  ],
  performance: [
    { campaign_id: "c-lead", spend: "12.5", impressions: "1000", inline_link_clicks: "40", leads: "3", currency: "EUR" },
    { campaign_id: "c-traffic", spend: "30", impressions: "5000" },
  ],
  currency: "EUR",
  now: NOW,
  brandAssetImageUrl: (assetId) => `https://images.example/${assetId}`,
  buildCombinations: buildMetaAdPreviewCombinations,
});

const byId = new Map(items.map((item) => [item.id, item]));
assert.deepEqual(items.map((item) => item.id), ["c-traffic", "c-lead", "c-ext", "c-boost"], "active first, then by spend");

const lead = byId.get("c-lead");
assert.equal(lead.kind, "lead");
assert.equal(lead.launchedByAdbot, true);
assert.equal(lead.previewMode, "dynamic");
assert.equal(lead.totalCombinationCount, 4);
assert.equal(lead.cards.length, 4);
assert.ok(lead.cards.every((card) => card.imageUrl.startsWith("https://images.example/")));
assert.ok(lead.cards.every((card) => card.callToActionLabel === "Jetzt bewerben"));
assert.deepEqual(new Set(lead.cards.map((card) => card.primaryText)), new Set(["Body A", "Body B"]));
assert.equal(lead.spend, 12.5);
assert.equal(lead.leads, 3);
assert.equal(lead.dailyBudgetMinor, 2000);

const traffic = byId.get("c-traffic");
assert.equal(traffic.kind, "traffic");
assert.equal(traffic.launchedByAdbot, true, "binding by remote id");
assert.equal(traffic.previewMode, "structural");
assert.equal(traffic.cards[0].primaryText, "Text 1", "synced creative text wins");
assert.equal(traffic.cards[0].imageUrl, "https://cdn.example/t1.jpg");
assert.equal(traffic.cards[0].callToActionLabel, "Registrieren");
assert.equal(traffic.cards[1].description, "Beschreibung 2");
assert.equal(traffic.cards[1].destinationUrl, "https://funnel.example/b");
assert.equal(traffic.cards[1].imageUrl, null);

const boost = byId.get("c-boost");
assert.equal(boost.kind, "boost");
assert.equal(boost.lifecycle, "archived");
assert.equal(boost.cards[0].primaryText, "Beworbener Beitrag");
assert.equal(boost.cards[0].imageUrl, "https://cdn.example/post.jpg");
assert.equal(boost.cards[0].instagramPermalinkUrl, "https://instagram.com/p/x");

const external = byId.get("c-ext");
assert.equal(external.kind, "other");
assert.equal(external.launchedByAdbot, false);
assert.equal(external.previewMode, "single");

// Funnel filter: only lead + traffic that promote a given funnel URL.
const funnel = filterFunnelCampaigns(items, ["https://funnel.example/start"]);
assert.deepEqual(funnel.map((item) => item.id).sort(), ["c-lead", "c-traffic"]);
assert.ok(funnel.every((item) => item.funnelUrl === "https://funnel.example/start"));
assert.deepEqual(filterFunnelCampaigns(items, ["https://funnel.example/b"]).map((item) => item.id), ["c-traffic"]);
assert.deepEqual(filterFunnelCampaigns(items, ["https://other.example/"]), []);
assert.deepEqual(filterFunnelCampaigns(items, []), []);

console.log("campaign-ad-overview: ok");
