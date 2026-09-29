"use client";

import { Globe2, MoreHorizontal } from "lucide-react";

import type { MetaAdPreviewCombination } from "@/lib/meta/ad-preview-combinations";

export type MetaAdPreviewCard = MetaAdPreviewCombination & {
  destinationUrl: string;
  previewLabel?: string;
  /** Direct image URL (e.g. synced Meta creative); wins over assetId. */
  imageUrl?: string | null;
  /** Per-card button text; falls back to the gallery's callToActionLabel. */
  callToActionLabel?: string;
};

type PreviewAsset = {
  id: string;
  originalFilename: string;
};

type Props = {
  cards: readonly MetaAdPreviewCard[];
  totalCombinationCount: number;
  isTruncated: boolean;
  mode: "single" | "dynamic" | "structural";
  advertiserName: string;
  instagramLabel?: string | null;
  assets: readonly PreviewAsset[];
  callToActionLabel: string;
  /** "live" describes ads already running at Meta instead of a launch preview. */
  context?: "preview" | "live";
};

function destinationHostname(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function advertiserInitials(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0]?.slice(0, 2) || "AD")
    .toUpperCase();
}

function imageSource(card: MetaAdPreviewCard): string | null {
  if (card.imageUrl) return card.imageUrl;
  return card.assetId
    ? `/api/media-library/preview?assetId=${encodeURIComponent(card.assetId)}`
    : null;
}

function combinationCountLabel(shown: number, total: number): string {
  if (shown === 1 && total === 1) return "1 konkrete Anzeige";
  if (shown === total) return `${shown} konkrete Kombinationen`;
  return `${shown} von ${total} möglichen Kombinationen`;
}

export function MetaAdPreviewGallery({
  cards,
  totalCombinationCount,
  isTruncated,
  mode,
  advertiserName,
  instagramLabel,
  assets,
  callToActionLabel,
  context = "preview",
}: Props) {
  const assetNames = new Map(
    assets.map((asset) => [asset.id, asset.originalFilename]),
  );
  const placementLabel = instagramLabel
    ? "Facebook- & Instagram-Feed"
    : "Facebook-Feed";

  return (
    <section aria-label="Meta-Anzeigenvorschau" className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-extrabold text-slate-950">
            {context === "live" ? "Anzeigen bei Meta" : "Meta-Anzeigenvorschau"}
          </h4>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-extrabold text-blue-800 ring-1 ring-blue-200">
            {context === "live" && mode !== "dynamic"
              ? `${cards.length} ${cards.length === 1 ? "Anzeige" : "Anzeigen"}`
              : combinationCountLabel(cards.length, totalCombinationCount)}
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          {context === "live" && mode !== "dynamic"
            ? cards.length > 1
              ? "Jede Karte zeigt eine Anzeige dieser Kampagne mit Motiv, Text, Headline und Zielseite."
              : "So erscheint die Anzeige dieser Kampagne bei Meta."
            : mode === "structural"
            ? "Jede Karte zeigt eine der zwei getrennten Anzeigen mit ihrem konkreten Motiv, Text, ihrer Headline und Zielseite."
            : mode === "dynamic"
              ? "Jede Karte kombiniert genau ein Motiv, einen Primary Text und eine Headline."
              : "Die Karte zeigt die konkrete Zusammensetzung aus einem Motiv, einem Primary Text und einer Headline."}
        </p>
        {mode === "dynamic" ? (
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">
            {isTruncated
              ? "Bei Dynamic Creative zeigt Adbot repräsentative mögliche Kombinationen. Meta kann alle gewählten Varianten dynamisch kombinieren und entscheidet selbst, welche davon ausgespielt wird."
              : "Meta kann diese gewählten Varianten dynamisch ausspielen und entscheidet selbst, welche Kombination wann erscheint."}
          </p>
        ) : null}
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Die tatsächliche Darstellung kann je nach Platzierung, Gerät und Meta-Oberfläche leicht abweichen.
        </p>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-2 2xl:grid-cols-3">
        {cards.map((card, index) => {
          const filename = assetNames.get(card.assetId) ?? "Werbemittel";
          const label =
            card.previewLabel ??
            (cards.length > 1 ? `Kombination ${index + 1}` : "Anzeige");

          return (
            <article
              className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm"
              key={`${card.assetId}:${card.primaryText}:${card.headline}:${index}`}
            >
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2">
                <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">
                  {label}
                </p>
                <p className="text-xs font-semibold text-slate-500">
                  {placementLabel}
                </p>
              </div>

              <div className="flex items-start gap-3 px-4 pb-2 pt-4">
                <div
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-blue-700 text-xs font-black text-white"
                >
                  {advertiserInitials(advertiserName)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold text-slate-950">
                    {advertiserName}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-slate-500">
                    Gesponsert <span aria-hidden="true">·</span>{" "}
                    <Globe2 aria-label="Öffentlich" className="size-3.5" />
                  </p>
                  {instagramLabel ? (
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      Instagram: {instagramLabel}
                    </p>
                  ) : null}
                </div>
                <MoreHorizontal aria-hidden="true" className="mt-1 size-5 text-slate-600" />
              </div>

              <p className="whitespace-pre-wrap px-4 pb-4 pt-2 text-[15px] leading-6 text-slate-900">
                {card.primaryText}
              </p>

              <div className="flex min-h-64 max-h-[430px] items-center justify-center overflow-hidden bg-slate-950">
                {imageSource(card) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={`${filename} in ${label}`}
                    className="max-h-[430px] w-full object-contain"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    src={imageSource(card) ?? undefined}
                  />
                ) : (
                  <p className="px-6 text-center text-sm font-semibold text-slate-300">
                    Kein Motiv verfügbar
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    {destinationHostname(card.destinationUrl)}
                  </p>
                  <h5 className="mt-0.5 line-clamp-2 text-base font-extrabold leading-5 text-slate-950">
                    {card.headline}
                  </h5>
                  {card.description ? (
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">
                      {card.description}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 rounded-md bg-slate-200 px-3 py-2 text-xs font-extrabold text-slate-800">
                  {card.callToActionLabel ?? callToActionLabel}
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
