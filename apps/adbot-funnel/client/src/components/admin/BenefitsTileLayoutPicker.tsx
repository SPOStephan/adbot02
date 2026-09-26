import { useState } from "react";
import { LayoutTemplate } from "lucide-react";
import type { BenefitsTileLayout } from "@shared/funnel";
import { BENEFITS_TILE_LAYOUT_META, resolveBenefitsTileLayout } from "@shared/startLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function BenefitsTileLayoutPicker({
  value,
  onChange,
}: {
  value: BenefitsTileLayout;
  onChange: (layout: BenefitsTileLayout) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = BENEFITS_TILE_LAYOUT_META.find(item => item.id === resolveBenefitsTileLayout(value)) ?? BENEFITS_TILE_LAYOUT_META[0]!;

  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-xl border bg-slate-50 p-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Vorteils-Vorlage</p>
          <p className="text-sm font-bold">{current.title}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          <LayoutTemplate className="size-4" />Vorlage wählen
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[86vh] overflow-y-auto max-w-[860px] sm:max-w-[860px]">
          <DialogHeader>
            <DialogTitle>Vorlage wählen</DialogTitle>
            <DialogDescription>
              Wähle die Optik unter dem Trenner. Weitere Vorlagen lassen sich später ergänzen. Texte, Icons und Farben bleiben dieselben.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {BENEFITS_TILE_LAYOUT_META.map(variant => {
              const selected = variant.id === resolveBenefitsTileLayout(value);
              return (
                <button
                  key={variant.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => { onChange(variant.id); setOpen(false); }}
                  className={`grid gap-3 rounded-2xl border p-3 text-left transition ${selected ? "border-[#0165c3] bg-[#0165c3]/6 shadow-sm" : "border-slate-200 hover:border-[#0165c3]/40"}`}
                >
                  <TileLayoutThumbnail layout={variant.id} />
                  <span>
                    <strong className="block text-sm">{variant.title}</strong>
                    <small className="block text-xs leading-5 text-muted-foreground">{variant.description}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TileLayoutThumbnail({ layout }: { layout: BenefitsTileLayout }) {
  if (layout === "cards") {
    return (
      <div className="grid gap-2 overflow-hidden rounded-xl border bg-[#f4f8fc] px-3 py-3">
        {Array.from({ length: 3 }, (_, index) => (
          <span key={index} className="grid grid-cols-[18px_minmax(0,1fr)] items-start gap-2 rounded-lg bg-white px-2 py-2 shadow-sm">
            <span className="size-4 rounded-full bg-[#0165c3]/12" />
            <span className="grid gap-1">
              <span className="h-1.5 w-16 rounded bg-slate-800" />
              <span className="h-1 w-full rounded bg-slate-200" />
            </span>
          </span>
        ))}
      </div>
    );
  }

  if (layout === "one-column") {
    return (
      <div className="grid gap-2 overflow-hidden rounded-xl border bg-white px-3 py-3">
        {Array.from({ length: 3 }, (_, index) => (
          <span key={index} className="grid grid-cols-[18px_minmax(0,1fr)] items-start gap-2">
            <span className="size-4 rounded-full border-2 border-[#0165c3]" />
            <span className="grid gap-1">
              <span className="h-1.5 w-16 rounded bg-slate-800" />
              <span className="h-1 w-full rounded bg-slate-200" />
              <span className="h-1 w-10/12 rounded bg-slate-200" />
            </span>
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 overflow-hidden rounded-xl border bg-white px-3 py-3">
      {Array.from({ length: 4 }, (_, index) => (
        <span key={index} className="grid justify-items-center content-start items-start gap-1">
          <span className="size-4 rounded-full border-2 border-[#0165c3]" />
          <span className="h-1.5 w-10 rounded bg-slate-300" />
          <span className="h-1 w-12 rounded bg-slate-200" />
        </span>
      ))}
    </div>
  );
}
