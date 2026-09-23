import { useState } from "react";
import { LayoutTemplate } from "lucide-react";
import type { StartPageLayout } from "@shared/funnel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const VARIANTS: Array<{
  id: StartPageLayout;
  title: string;
  description: string;
}> = [
  {
    id: "classic",
    title: "Klassisch",
    description: "Text links, Bild rechts. Vorteile als Liste unter der Headline.",
  },
  {
    id: "benefits",
    title: "Vorteile & Icons",
    description: "Headline und Button, dann Branding-Trenner und Icon-Kacheln – immer zwei pro Reihe.",
  },
];

export function StartLayoutPicker({
  value,
  onChange,
}: {
  value: StartPageLayout;
  onChange: (layout: StartPageLayout) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = VARIANTS.find(item => item.id === value) ?? VARIANTS[0]!;

  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-xl border bg-slate-50 p-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Startseiten-Layout</p>
          <p className="text-sm font-bold">{current.title}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          <LayoutTemplate className="size-4" />Layout anpassen
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[720px] sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Layout anpassen</DialogTitle>
            <DialogDescription>Wähle den Aufbau der Startseite. Texte, Bilder und Icons bleiben im selben Editor bearbeitbar.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {VARIANTS.map(variant => {
              const selected = variant.id === value;
              return (
                <button
                  key={variant.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => { onChange(variant.id); setOpen(false); }}
                  className={`grid gap-3 rounded-2xl border p-3 text-left transition ${selected ? "border-[#0165c3] bg-[#0165c3]/6 shadow-sm" : "border-slate-200 hover:border-[#0165c3]/40"}`}
                >
                  <LayoutThumbnail layout={variant.id} />
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

function LayoutThumbnail({ layout }: { layout: StartPageLayout }) {
  if (layout === "benefits") {
    return (
      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="grid justify-items-center gap-1 px-3 py-3 text-center">
          <span className="h-1.5 w-16 rounded bg-slate-200" />
          <span className="h-2.5 w-28 rounded bg-slate-800" />
          <span className="mt-1 h-4 w-16 rounded-full bg-[#0165c3]" />
        </div>
        <div className="bg-[#0165c3] px-3 py-2 text-center text-[9px] font-bold text-white">Deine Vorteile</div>
        <div className="grid grid-cols-2 gap-2 px-3 py-3">
          {Array.from({ length: 4 }, (_, index) => (
            <span key={index} className="grid justify-items-center gap-1">
              <span className="size-4 rounded-full border-2 border-[#0165c3]" />
              <span className="h-1.5 w-10 rounded bg-slate-300" />
              <span className="h-1 w-12 rounded bg-slate-200" />
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[1.1fr_.9fr] gap-2 overflow-hidden rounded-xl border bg-white p-3">
      <div className="grid gap-1.5 content-start">
        <span className="h-1.5 w-14 rounded bg-[#0165c3]/40" />
        <span className="h-2.5 w-full rounded bg-slate-800" />
        <span className="h-1.5 w-16 rounded bg-slate-200" />
        <span className="h-1.5 w-20 rounded bg-slate-200" />
        <span className="mt-1 h-4 w-14 rounded-md bg-[#0165c3]" />
      </div>
      <span className="rounded-lg bg-slate-100" />
    </div>
  );
}
