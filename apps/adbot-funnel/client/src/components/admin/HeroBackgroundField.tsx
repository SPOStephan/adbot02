import { useState } from "react";
import { ImageIcon, Loader2, UploadCloud, X } from "lucide-react";
import type { FunnelMediaAsset, StartPage } from "@shared/funnel";
import { clampHeroBackgroundOpacity, DEFAULT_HERO_BACKGROUND_OPACITY } from "@shared/startLayout";
import { prepareHeroBackgroundVariants } from "@/lib/heroBackgroundImage";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

export function HeroBackgroundField({
  funnelId,
  page,
  onChange,
}: {
  funnelId: string;
  page: StartPage;
  onChange: (patch: Partial<StartPage>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const library = trpc.funnel.mediaLibrary.useQuery({ funnelId }, { enabled: open });
  const upload = trpc.funnel.uploadHeroBackground.useMutation();
  const opacity = clampHeroBackgroundOpacity(page.heroBackgroundOpacity);
  const hasImage = Boolean(page.heroBackgroundDesktopUrl || page.heroBackgroundMobileUrl);

  const applyAsset = (asset: FunnelMediaAsset) => {
    onChange({
      heroBackgroundAssetId: asset.id,
      heroBackgroundDesktopUrl: asset.desktopUrl,
      heroBackgroundMobileUrl: asset.mobileUrl,
    });
    setOpen(false);
  };

  const selectFile = async (file?: File) => {
    if (!file) return;
    setPending(true);
    try {
      const prepared = await prepareHeroBackgroundVariants(file);
      const asset = await upload.mutateAsync({
        funnelId,
        fileName: prepared.filename,
        desktop: prepared.desktop,
        mobile: prepared.mobile,
      });
      await library.refetch();
      applyAsset(asset);
      toast.success("Hintergrundbild hochgeladen und zugeschnitten.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Das Bild konnte nicht hochgeladen werden.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-3 rounded-xl border bg-slate-50 p-3">
      <div>
        <p className="text-sm font-bold">Hintergrundbild</p>
        <p className="text-xs text-muted-foreground">Liegt nur im Bereich über dem Trenner. Standard 15&nbsp;% Deckkraft, damit der Text lesbar bleibt.</p>
      </div>
      {hasImage && (
        <div className="overflow-hidden rounded-xl border bg-white">
          <img className="h-28 w-full object-cover" src={page.heroBackgroundMobileUrl || page.heroBackgroundDesktopUrl} alt="" />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          <UploadCloud className="size-4" />Bild hochladen
        </Button>
        {hasImage && (
          <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => onChange({ heroBackgroundAssetId: "", heroBackgroundDesktopUrl: "", heroBackgroundMobileUrl: "" })}>
            <X className="size-4" />Entfernen
          </Button>
        )}
      </div>
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label>Deckkraft</Label>
          <div className="flex items-center gap-1">
            <Input
              className="h-8 w-16 bg-white text-center font-mono text-sm"
              inputMode="numeric"
              value={String(opacity)}
              aria-label="Deckkraft in Prozent"
              onChange={event => onChange({ heroBackgroundOpacity: clampHeroBackgroundOpacity(event.target.value.replace(/[^\d]/g, "")) })}
            />
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        </div>
        <Slider
          min={0}
          max={100}
          step={1}
          value={[opacity]}
          aria-label="Deckkraft"
          onValueChange={values => onChange({ heroBackgroundOpacity: clampHeroBackgroundOpacity(values[0] ?? DEFAULT_HERO_BACKGROUND_OPACITY) })}
        />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[640px] sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>Hintergrundbild</DialogTitle>
            <DialogDescription>Wähle ein Bild aus deiner Bibliothek oder lade ein neues hoch. Es wird automatisch für Mobil und Desktop zugeschnitten und als WebP gespeichert.</DialogDescription>
          </DialogHeader>
          <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border bg-white px-3 text-sm font-medium shadow-xs hover:bg-slate-50">
            {pending || upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
            Neues Bild hochladen
            <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={pending || upload.isPending} onChange={event => { void selectFile(event.target.files?.[0]); event.target.value = ""; }} />
          </label>
          <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
            {(library.data ?? []).map(asset => (
              <button
                key={asset.id}
                type="button"
                className={`overflow-hidden rounded-xl border text-left ${page.heroBackgroundAssetId === asset.id ? "border-[#0165c3] ring-2 ring-[#0165c3]/30" : "border-slate-200"}`}
                onClick={() => applyAsset(asset)}
              >
                {asset.mobileUrl || asset.desktopUrl
                  ? <img className="h-24 w-full object-cover" src={asset.mobileUrl || asset.desktopUrl} alt="" />
                  : <span className="grid h-24 place-items-center bg-slate-100"><ImageIcon className="size-6 text-slate-400" /></span>}
                <span className="block truncate px-2 py-1.5 text-[11px] font-medium">{asset.filename}</span>
              </button>
            ))}
          </div>
          {library.isLoading && <p className="text-sm text-muted-foreground">Bibliothek wird geladen …</p>}
          {!library.isLoading && (library.data?.length ?? 0) === 0 && <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-sm text-muted-foreground">Noch keine Hintergrundbilder. Lade das erste hoch.</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
