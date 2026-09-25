import "server-only";

import {
  emptyIdeaCore,
  parseIdeaCore,
  parseRealizedCopy,
  type CampaignIdeaCore,
  type CampaignIdeaRealizedCopy,
  type CampaignIdeaSourceType,
} from "@/lib/campaign-pipeline/idea-core";

function openRouterApiKey(): string | null {
  const raw =
    process.env.CREATIVE_ASSET_OPENROUTER_API_KEY ??
    process.env.OPENROUTER_API_KEY ??
    "";
  return raw.trim() || null;
}

function extractModel(): string {
  return (
    process.env.CAMPAIGN_IDEA_EXTRACT_MODEL?.trim() ||
    process.env.PLATFORM_LIBRARY_CAPTION_MODEL?.trim() ||
    "openai/gpt-4o-mini"
  );
}

function openRouterBase(): string {
  return (
    process.env.CREATIVE_ASSET_OPENROUTER_BASE_URL ??
    "https://openrouter.ai/api/v1"
  ).replace(/\/+$/, "");
}

const CORE_SYSTEM = [
  "Du analysierst Werbung nur als Inspiration.",
  "Extrahiere den strategischen Kern: Produkt, Angebot, Zielgruppe, Hook-Muster, Ton, visuelles Motiv, Funnel-Winkel.",
  "Niemals Texte, Slogans, Markennamen oder Layouts zum 1:1-Kopieren vorschlagen.",
  "Fremde Claims gehören nach forbidden_verbatim.",
  "Antwort nur als JSON-Objekt mit den Schlüsseln:",
  "product, offer, audience, hook_pattern, tone, visual_motif, funnel_angle, core_summary, forbidden_verbatim.",
  "core_summary: 1-2 Sätze auf Deutsch, was Adbot umsetzen soll — ohne Fremdmarke.",
  "not_for_direct_use ist immer wahr.",
].join(" ");

const COPY_SYSTEM = [
  "Du schreibst originelle Meta-Anzeigentexte auf Deutsch.",
  "Nutze nur den extrahierten Kern und die eigene Landingpage des Kunden.",
  "Keine wörtlichen Übernahmen aus Fremdanzeigen, keine erfundenen Testsiegel.",
  "Antwort nur als JSON: primaryText, headline, description.",
].join(" ");

async function chatJson(input: {
  system: string;
  userText: string;
  image?: { mimeType: "image/png" | "image/jpeg"; bytes: Uint8Array };
}): Promise<unknown> {
  const apiKey = openRouterApiKey();
  if (!apiKey) return null;

  const userContent: Array<Record<string, unknown>> = [
    { type: "text", text: input.userText },
  ];
  if (input.image) {
    userContent.push({
      type: "image_url",
      image_url: {
        url: `data:${input.image.mimeType};base64,${Buffer.from(input.image.bytes).toString("base64")}`,
      },
    });
  }

  const response = await fetch(`${openRouterBase()}/chat/completions`, {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: extractModel(),
      temperature: 0.3,
      max_tokens: 600,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: userContent },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`idea_extract_http_${response.status}`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const raw = payload.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1)) as unknown;
    }
    return null;
  }
}

export async function extractCampaignIdeaCore(input: {
  sourceType: CampaignIdeaSourceType;
  sourceUrl: string | null;
  keywords: string | null;
  notes: string | null;
  pageTitle?: string;
  pageDescription?: string;
  pageExcerpt?: string;
  screenshot?: { mimeType: "image/png" | "image/jpeg"; bytes: Uint8Array };
}): Promise<CampaignIdeaCore> {
  const fallback = emptyIdeaCore(
    [input.keywords, input.notes, input.pageTitle, input.sourceUrl]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join(" · ")
      .slice(0, 400),
  );
  const userText = [
    `Quelle: ${input.sourceType}`,
    input.sourceUrl ? `Link (nur Inspiration): ${input.sourceUrl}` : "",
    input.keywords ? `Stichworte: ${input.keywords}` : "",
    input.notes ? `Notiz: ${input.notes}` : "",
    input.pageTitle ? `Seitentitel: ${input.pageTitle}` : "",
    input.pageDescription ? `Beschreibung: ${input.pageDescription}` : "",
    input.pageExcerpt ? `Auszug: ${input.pageExcerpt.slice(0, 1800)}` : "",
    input.screenshot
      ? "Screenshot ist eine fremde Anzeige. Nur Muster abstrahieren, nichts abschreiben."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const json = await chatJson({
      system: CORE_SYSTEM,
      userText,
      image: input.screenshot,
    });
    if (!json) return fallback;
    return parseIdeaCore(json);
  } catch {
    return fallback;
  }
}

export async function writeCampaignCopyFromCore(input: {
  core: CampaignIdeaCore;
  destinationUrl: string;
  objective: string;
  pageTitle?: string;
  pageDescription?: string;
}): Promise<CampaignIdeaRealizedCopy> {
  const fallback: CampaignIdeaRealizedCopy = {
    primaryText:
      input.core.offer ||
      input.core.core_summary ||
      "Mehr erfahren — passend zu deinem Angebot.",
    headline: input.core.product || "Jetzt mehr erfahren",
    description: input.core.funnel_angle || "",
  };
  const userText = [
    `Ziel: ${input.objective}`,
    `Eigene Landingpage: ${input.destinationUrl}`,
    input.pageTitle ? `Seitentitel: ${input.pageTitle}` : "",
    input.pageDescription ? `Seitenbeschreibung: ${input.pageDescription}` : "",
    `Kern: ${JSON.stringify(input.core)}`,
    "Schreibe frische Texte für DIESE Marke. Verbotene Phrasen nicht verwenden:",
    input.core.forbidden_verbatim.join(" | ") || "(keine)",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const json = await chatJson({ system: COPY_SYSTEM, userText });
    return parseRealizedCopy(json) ?? fallback;
  } catch {
    return fallback;
  }
}

export function creativePromptFromCore(core: CampaignIdeaCore): string {
  const parts = [
    "Originales Werbemotiv, keine Kopie einer existierenden Anzeige.",
    core.visual_motif && `Motiv: ${core.visual_motif}`,
    core.product && `Produkt: ${core.product}`,
    core.offer && `Angebot: ${core.offer}`,
    core.tone && `Stimmung: ${core.tone}`,
    core.audience && `Zielgruppe: ${core.audience}`,
    "Fotorealistisch oder klare Grafik, Platz für kurzen Headline-Text, keine lesbaren Fremdmarken.",
  ].filter(Boolean);
  return parts.join(" ");
}
