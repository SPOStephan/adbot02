import type { ArchivedAdKind, ArchivedAdRecord, MetaAdLibraryProbeAd } from "./types";

const COUNTRY_LABELS: Record<string, string> = {
  DE: "Deutschland",
  AT: "Österreich",
  CH: "Schweiz",
};

const LANGUAGE_LABELS: Record<string, string> = {
  de: "Deutsch",
  en: "English",
  fr: "Französisch",
  it: "Italienisch",
};

export function firstText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = firstText(item);
      if (text) return text;
    }
  }
  return "";
}

export function textList(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) {
    const single = firstText(value);
    return single ? [single] : [];
  }
  return value
    .map((item) => firstText(item))
    .filter(Boolean)
    .slice(0, max);
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function classifyArchivedAd(ad: Record<string, unknown>): ArchivedAdKind {
  if (firstText(ad.bylines) || ad.spend != null || ad.impressions != null || ad.currency) {
    return "political";
  }
  if (firstText(ad.ad_creative_bodies) || firstText(ad.ad_creative_link_titles)) {
    return "commercial";
  }
  return "unknown";
}

export function daysRunningSince(start: string | null, now = Date.now()): number | null {
  if (!start) return null;
  const parsed = Date.parse(start);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((now - parsed) / 86_400_000));
}

export function officialLibraryUrl(id: string): string {
  return `https://www.facebook.com/ads/library/?id=${encodeURIComponent(id)}`;
}

export function countryLabel(code: string): string {
  const normalized = code.trim().toUpperCase();
  return COUNTRY_LABELS[normalized] ?? normalized;
}

export function languageLabel(code: string): string {
  const normalized = code.trim().toLowerCase();
  return LANGUAGE_LABELS[normalized] ?? code.trim();
}

export function normalizeCountryCodes(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,]+/)
      : [];
  const codes = raw
    .map((item) => String(item).trim().toUpperCase())
    .filter((item) => /^[A-Z]{2}$/.test(item));
  return [...new Set(codes)].slice(0, 8);
}

export function parseArchivedAd(value: unknown, now = Date.now()): ArchivedAdRecord | null {
  const ad = record(value);
  const id = firstText(ad.id);
  if (!id) return null;
  const deliveryStart = firstText(ad.ad_delivery_start_time) || null;
  return {
    id,
    pageId: firstText(ad.page_id) || null,
    pageName: firstText(ad.page_name) || "Unbekannte Page",
    bodies: textList(ad.ad_creative_bodies),
    titles: textList(ad.ad_creative_link_titles),
    captions: textList(ad.ad_creative_link_captions),
    descriptions: textList(ad.ad_creative_link_descriptions),
    snapshotUrl: firstText(ad.ad_snapshot_url) || null,
    languages: textList(ad.languages),
    platforms: textList(ad.publisher_platforms),
    deliveryStart,
    deliveryStop: firstText(ad.ad_delivery_stop_time) || null,
    euTotalReach: typeof ad.eu_total_reach === "number" ? ad.eu_total_reach : null,
    bylines: firstText(ad.bylines) || null,
    kind: classifyArchivedAd(ad),
    daysRunning: daysRunningSince(deliveryStart, now),
  };
}

export function hookFromArchivedAd(ad: ArchivedAdRecord): string {
  return (ad.titles[0] || ad.bodies[0] || "").slice(0, 180);
}

export function archivedAdToProbe(ad: ArchivedAdRecord): MetaAdLibraryProbeAd {
  return {
    id: ad.id,
    pageName: ad.pageName,
    hookText: hookFromArchivedAd(ad),
    bodyText: (ad.bodies[0] || "").slice(0, 280),
    ctaText: (ad.captions[0] || "").slice(0, 120),
    daysRunning: ad.daysRunning,
    kind: ad.kind,
    sourceUrl: officialLibraryUrl(ad.id),
    languages: ad.languages,
  };
}

export function archivedAdToCollectorRecord(
  ad: ArchivedAdRecord,
  hints: {
    industry: string;
    objective: string;
    country: string;
    collectorBatchId: string;
    searchTerms: string;
    longRunningDays: number;
  },
): Record<string, unknown> {
  const hook = hookFromArchivedAd(ad);
  const body = ad.bodies[0] || ad.descriptions[0] || "";
  const country = countryLabel(hints.country);
  const language = languageLabel(ad.languages[0] || "de");
  const longRunning =
    hints.longRunningDays > 0 &&
    ad.daysRunning != null &&
    ad.daysRunning >= hints.longRunningDays;
  return {
    provider: "meta",
    external_id: ad.id,
    collector_batch_id: hints.collectorBatchId,
    platform: "meta",
    source_kind: "official_library",
    source_url: officialLibraryUrl(ad.id),
    title: `${ad.pageName}: ${hook || "Library-Anzeige"}`.slice(0, 120),
    advertiser_name: ad.pageName.slice(0, 120),
    industry: hints.industry.slice(0, 100) || "Nicht klassifiziert",
    objective: hints.objective || "other",
    objective_detail:
      `Offizielle Meta Ad Library, Suche „${hints.searchTerms}“. ` +
      "Nur Transparenz / Muster — kein Leistungsbeleg.",
    funnel_stage: "conversion",
    evidence_level: "public_transparency",
    rights_basis: "reference_only",
    rights_confirmed: true,
    format: ad.platforms.join(", ") || "Meta-Anzeige",
    country,
    language,
    hook_text: hook,
    body_text: body.slice(0, 2000),
    cta_text: (ad.captions[0] || "").slice(0, 120),
    performance_note: [
      ad.deliveryStart ? `Auslieferung start ${ad.deliveryStart}` : "",
      ad.deliveryStop ? `Stop ${ad.deliveryStop}` : "Noch aktiv oder ohne Stop-Zeit",
      ad.daysRunning != null ? `${ad.daysRunning} Tage sichtbar` : "",
      ad.euTotalReach != null ? `EU-Reichweite (Schätzung) ${ad.euTotalReach}` : "",
    ]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 1000),
    why_it_works:
      "Öffentliche Library-Sichtbarkeit. Lang laufend ist ein Proxy, kein ROAS.",
    tags: [
      "meta-ad-library",
      "public_transparency",
      hints.country.toLowerCase(),
      ad.kind,
      longRunning ? "long-running" : "",
    ].filter(Boolean),
    quality_rating: 3,
    use_for_generation: false,
    raw_payload: {
      provider: "meta",
      ad_library_id: ad.id,
      page_id: ad.pageId,
      snapshot_url: ad.snapshotUrl,
      search_terms: hints.searchTerms,
      kind: ad.kind,
    },
  };
}
