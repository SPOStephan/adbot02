"use client";

import { Camera, ImageOff, Megaphone, Play } from "lucide-react";
import { useState } from "react";

type ContentCandidatePreviewProps = {
  previewUrl: string | null;
  source: "facebook" | "instagram";
  contentType: "post" | "image" | "video" | "carousel" | "reel" | "unknown";
};

const CONTENT_TYPE_LABELS: Record<
  ContentCandidatePreviewProps["contentType"],
  string
> = {
  post: "Beitrag",
  image: "Bild",
  video: "Video",
  carousel: "Karussell",
  reel: "Reel",
  unknown: "Vorschau",
};

export function ContentCandidatePreview({
  previewUrl,
  source,
  contentType,
}: ContentCandidatePreviewProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(previewUrl && failedUrl !== previewUrl);
  const SourceIcon = source === "instagram" ? Camera : Megaphone;
  const TypeIcon = contentType === "video" || contentType === "reel" ? Play : SourceIcon;
  const platformLabel = source === "instagram" ? "Instagram" : "Facebook";

  return (
    <div className="relative aspect-[16/9] overflow-hidden border-b border-slate-100 bg-slate-100">
      {showImage ? (
        // Meta liefert kurzlebige CDN-Hosts. Ein natives Bild vermeidet eine globale
        // Host-Freigabe im Image-Optimizer und fällt bei abgelaufenen URLs lokal zurück.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={`${platformLabel}-Beitragsvorschau`}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
          decoding="async"
          loading="lazy"
          onError={() => setFailedUrl(previewUrl)}
          referrerPolicy="no-referrer"
          src={previewUrl ?? undefined}
        />
      ) : (
        <div
          aria-label={`${platformLabel}-Beitragsvorschau nicht verfügbar`}
          className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-50 to-slate-100 px-5 text-center text-slate-500"
          role="img"
        >
          <span className="grid size-11 place-items-center rounded-full bg-white shadow-sm ring-1 ring-slate-200">
            <ImageOff className="size-5" aria-hidden="true" />
          </span>
          <span className="text-xs font-semibold">Keine Vorschau verfügbar</span>
        </div>
      )}

      <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-slate-950/75 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm backdrop-blur-sm">
        <TypeIcon className="size-3.5" aria-hidden="true" />
        {CONTENT_TYPE_LABELS[contentType]}
      </span>
    </div>
  );
}
