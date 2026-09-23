import "server-only";

function openRouterApiKey(): string | null {
  const raw =
    process.env.CREATIVE_ASSET_OPENROUTER_API_KEY ??
    process.env.OPENROUTER_API_KEY ??
    "";
  const key = raw.trim();
  return key || null;
}

function captionModel(): string {
  const raw = process.env.PLATFORM_LIBRARY_CAPTION_MODEL?.trim();
  return raw || "openai/gpt-4o-mini";
}

export async function describePlatformMotifImage(input: {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg";
}): Promise<string | null> {
  const apiKey = openRouterApiKey();
  if (!apiKey) return null;

  const base =
    (process.env.CREATIVE_ASSET_OPENROUTER_BASE_URL ??
      "https://openrouter.ai/api/v1").replace(/\/+$/, "");
  const dataUrl = `data:${input.mimeType};base64,${Buffer.from(input.bytes).toString("base64")}`;

  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: captionModel(),
      temperature: 0.2,
      max_tokens: 180,
      messages: [
        {
          role: "system",
          content:
            "Du beschreibst Werbemotive knapp auf Deutsch. Ein bis zwei Sätze: Motiv, Stimmung, erkennbare Objekte. Keine Markennamen erfinden, keine Handlungsaufforderung, kein Layout-Jargon.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Kurze Inhaltsangabe für die Adbot-Motivbibliothek.",
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`caption_http_${response.status}`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const raw = payload.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw.trim() : "";
  return text ? text.slice(0, 400) : null;
}
