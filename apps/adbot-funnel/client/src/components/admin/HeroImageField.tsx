import { useState } from "react";
import { ImageIcon, Loader2, UploadCloud, X } from "lucide-react";
import type { HeroImageLayout } from "@shared/funnel";
import { clampHeroImageRadius, DEFAULT_HERO_IMAGE_RADIUS, MAX_HERO_IMAGE_RADIUS, resolveHeroImageLayout } from "@shared/startLayout";
import { prepareHeroImage } from "@/lib/heroBackgroundImage";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const LAYOUTS: Array<{ id: HeroImageLayout; title: string; description: string }> = [
  { id: "circle", title: "Kreis", description: "Kleines rundes Portrait über der Überschrift." },
  { id: "wide", title: "Großes Bild", description: "Breites Motiv mit einstellbarer Eckenrundung." },
];

export function HeroImageField({
  funnelId,
  value,
  layout,
  radius,
  onChange,
  showLayout = false,
  label = "Bildelement (optional)",
  hint = "Eigenes Foto über der Überschrift, zum Beispiel ein Portrait. Unabhängig vom Hintergrundbild.",
}: {
  funnelId: string;
  value: string;
  layout?: HeroImageLayout;
  radius?: number;
  onChange: (patch: { heroImageUrl?: string; heroImageLayout?: HeroImageLayout; heroImageRadius?: number }) => void;
  showLayout?: boolean;
  label?: string;
  hint?: string;
}) {
  const [pending, setPending] = useState(false);
  const upload = trpc.funnel.uploadHeroImage.useMutation();
  const hasImage = Boolean(value.trim());
  const currentLayout = resolveHeroImageLayout(layout);
  const currentRadius = clampHeroImageRadius(radius);

  const selectFile = async (file?: File) => {
    if (!file) return;
    setPending(true);
    try {
      const prepared = await prepareHeroImage(file);
      const stored = await upload.mutateAsync({
        funnelId,
        fileName: prepared.filename,
        mimeType: prepared.image.mimeType,
        size: prepared.image.size,
        dataBase64: prepared.image.dataBase64,
      });
      onChange({ heroImageUrl: stored.url });
      toast.success("Bildelement hochgeladen und als WebP gespeichert.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Das Bild konnte nicht hochgeladen werden.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-3 rounded-xl border bg-slate-50 p-3">
      <div>
        <p className="text-sm font-bold">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[96px_minmax(0,1fr)]">
        <div className="grid h-20 place-items-center overflow-hidden rounded-2xl border bg-white">
          {hasImage
            ? <img className="h-full w-full object-cover" src={value} alt="" />
            : <ImageIcon className="size-7 text-slate-400" aria-hidden="true" />}
        </div>
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-white px-3 text-sm font-medium shadow-xs transition hover:bg-slate-100">
              {pending || upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
              {pending || upload.isPending ? "Wird hochgeladen …" : "Bild hochladen"}
              <input
                className="sr-only"
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif"
                disabled={pending || upload.isPending}
                onChange={event => { void selectFile(event.target.files?.[0]); event.target.value = ""; }}
              />
            </label>
            {hasImage && (
              <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => onChange({ heroImageUrl: "" })}>
                <X className="size-4" />Entfernen
              </Button>
            )}
          </div>
          <Input
            value={value}
            placeholder="https://…/portrait.webp"
            aria-label={`${label} URL`}
            onChange={event => onChange({ heroImageUrl: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">Upload landet bei Bunny als WebP. Alternativ eine vorhandene HTTPS-Adresse eintragen.</p>
        </div>
      </div>

      {showLayout && hasImage && (
        <div className="grid gap-3">
          <div>
            <Label>Darstellung</Label>
            <p className="mt-1 text-xs text-muted-foreground">Kreis bleibt die kompakte Variante. Großes Bild füllt die Breite über der Überschrift.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {LAYOUTS.map(option => {
              const selected = option.id === currentLayout;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onChange({ heroImageLayout: option.id })}
                  className={`grid gap-2 rounded-2xl border p-3 text-left transition ${selected ? "border-[#0165c3] bg-[#0165c3]/6 shadow-sm" : "border-slate-200 bg-white hover:border-[#0165c3]/40"}`}
                >
                  <LayoutThumbnail layout={option.id} radius={currentRadius} />
                  <span>
                    <strong className="block text-sm">{option.title}</strong>
                    <small className="block text-xs leading-5 text-muted-foreground">{option.description}</small>
                  </span>
                </button>
              );
            })}
          </div>
          {currentLayout === "wide" && (
            <div className="grid gap-1">
              <Label htmlFor="hero-image-radius">Eckenrundung</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="hero-image-radius"
                  className="h-9 w-24 bg-white font-mono"
                  inputMode="numeric"
                  value={String(currentRadius)}
                  aria-label="Eckenrundung in Pixel"
                  onChange={event => onChange({ heroImageRadius: clampHeroImageRadius(event.target.value.replace(/[^\d]/g, "")) })}
                />
                <span className="text-xs text-muted-foreground">px · 0 = eckig, Standard {DEFAULT_HERO_IMAGE_RADIUS}, max. {MAX_HERO_IMAGE_RADIUS}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LayoutThumbnail({ layout, radius }: { layout: HeroImageLayout; radius: number }) {
  if (layout === "wide") {
    return (
      <div className="overflow-hidden rounded-xl border bg-[#f4f8fc] p-2">
        <span className="block h-10 w-full bg-slate-300" style={{ borderRadius: `${Math.min(radius, 16)}px` }} />
      </div>
    );
  }
  return (
    <div className="grid place-items-center overflow-hidden rounded-xl border bg-[#f4f8fc] py-3">
      <span className="size-8 rounded-full bg-slate-300" />
    </div>
  );
}
