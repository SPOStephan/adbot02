import { useState } from "react";
import { LayoutTemplate } from "lucide-react";
import type { ProgressLayout } from "@shared/funnel";
import { PROGRESS_LAYOUT_META, resolveProgressLayout } from "@shared/progressLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function ProgressLayoutPicker({
  value,
  onChange,
}: {
  value: ProgressLayout;
  onChange: (layout: ProgressLayout) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = PROGRESS_LAYOUT_META.find(item => item.id === resolveProgressLayout(value)) ?? PROGRESS_LAYOUT_META[0]!;

  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-xl border bg-slate-50 p-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fortschrittsanzeige</p>
          <p className="text-sm font-bold">{current.title}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          <LayoutTemplate className="size-4" />Variante wählen
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[86vh] overflow-y-auto max-w-[860px] sm:max-w-[860px]">
          <DialogHeader>
            <DialogTitle>Fortschritt anpassen</DialogTitle>
            <DialogDescription>
              Wähle die Optik der Statusanzeige. Stufennamen und Farben bleiben im Editor frei änderbar.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {PROGRESS_LAYOUT_META.map(variant => {
              const selected = variant.id === resolveProgressLayout(value);
              return (
                <button
                  key={variant.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => { onChange(variant.id); setOpen(false); }}
                  className={`grid gap-3 rounded-2xl border p-3 text-left transition ${selected ? "border-[#0165c3] bg-[#0165c3]/6 shadow-sm" : "border-slate-200 hover:border-[#0165c3]/40"}`}
                >
                  <ProgressThumbnail layout={variant.id} />
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

function ProgressThumbnail({ layout }: { layout: ProgressLayout }) {
  if (layout === "segments") {
    return (
      <div className="grid grid-cols-3 gap-2.5 overflow-hidden rounded-xl border bg-white px-3 py-4">
        {["Bewerbung", "Matching", "Gespräch"].map((label, index) => (
          <span key={label} className="grid justify-items-center gap-2">
            <span className={`h-1.5 w-full rounded-full ${index === 0 ? "bg-[#0165c3]" : "bg-[#c5d3e0]"}`} />
            <span className={`text-center text-[9px] font-semibold ${index === 0 ? "text-[#0165c3]" : "text-slate-400"}`}>{label}</span>
          </span>
        ))}
      </div>
    );
  }

  if (layout === "percent" || layout === "bar" || layout === "reduced") {
    return (
      <div className="grid gap-2 overflow-hidden rounded-xl border bg-white p-3">
        <span className="flex justify-between text-[9px] font-bold text-slate-400">
          <span>Schritt 1 von 3</span>
          {layout === "percent" ? <span>0%</span> : null}
        </span>
        <span className="h-1.5 overflow-hidden rounded-full bg-slate-200">
          <span className="block h-full w-1/3 rounded-full bg-[#0165c3]" />
        </span>
        {layout === "bar" ? (
          <span className="grid gap-1 text-[9px] text-slate-500">
            <span>1. Job-Check</span>
            <span>2. Kurzprofil</span>
          </span>
        ) : null}
        {layout === "reduced" ? <span className="text-[11px] font-bold">Job-Check</span> : null}
      </div>
    );
  }

  if (layout === "chevrons") {
    return (
      <div className="flex overflow-hidden rounded-xl border bg-white">
        <span className="flex-1 bg-[#0165c3] px-2 py-3 text-[9px] font-bold text-white">1 Job</span>
        <span className="flex-1 bg-slate-100 px-2 py-3 text-[9px] text-slate-500">2 Profil</span>
      </div>
    );
  }

  if (layout === "chips") {
    return (
      <div className="grid grid-cols-3 gap-1 overflow-hidden rounded-xl border bg-white p-2">
        <span className="rounded-lg bg-[#0165c3]/10 p-2 text-[9px] font-bold text-[#0165c3]">1 Job</span>
        <span className="rounded-lg border p-2 text-[9px] text-slate-500">2 Profil</span>
        <span className="rounded-lg border p-2 text-[9px] text-slate-500">3 Talk</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2 overflow-hidden rounded-xl border bg-white px-3 py-4">
      {[1, 2, 3].map(index => (
        <span key={index} className="grid justify-items-center gap-1">
          <span className={`grid size-6 place-items-center rounded-full text-[9px] font-bold ${index === 1 ? "bg-[#0165c3] text-white" : "border text-slate-400"}`}>
            {layout === "bold" ? `0${index}` : layout === "checks" && index === 1 ? "✓" : layout === "icons" || layout === "illustrated" || layout === "brand" ? "●" : index}
          </span>
          <span className="h-1.5 w-10 rounded bg-slate-300" />
        </span>
      ))}
    </div>
  );
}
