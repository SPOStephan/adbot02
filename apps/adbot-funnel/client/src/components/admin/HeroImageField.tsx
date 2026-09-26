import { useState } from "react";
import { ImageIcon, Loader2, UploadCloud, X } from "lucide-react";
import { prepareHeroImage } from "@/lib/heroBackgroundImage";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export function HeroImageField({
  funnelId,
  value,
  onChange,
  label = "Bildelement (optional)",
  hint = "Eigenes Foto über der Überschrift, zum Beispiel ein Portrait. Unabhängig vom Hintergrundbild.",
}: {
  funnelId: string;
  value: string;
  onChange: (url: string) => void;
  label?: string;
  hint?: string;
}) {
  const [pending, setPending] = useState(false);
  const upload = trpc.funnel.uploadHeroImage.useMutation();
  const hasImage = Boolean(value.trim());

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
      onChange(stored.url);
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
              <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => onChange("")}>
                <X className="size-4" />Entfernen
              </Button>
            )}
          </div>
          <Input
            value={value}
            placeholder="https://…/portrait.webp"
            aria-label={`${label} URL`}
            onChange={event => onChange(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">Upload landet bei Bunny als WebP. Alternativ eine vorhandene HTTPS-Adresse eintragen.</p>
        </div>
      </div>
    </div>
  );
}
