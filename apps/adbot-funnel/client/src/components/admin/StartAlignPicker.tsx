import { AlignCenter, AlignLeft } from "lucide-react";
import type { StartTextAlign } from "@shared/funnel";
import { resolveStartTextAlign } from "@shared/startLayout";

export type StartAlignValues = {
  headlineAlign?: StartTextAlign;
  descriptionAlign?: StartTextAlign;
  badgesAlign?: StartTextAlign;
};

const ROWS: { key: keyof StartAlignValues; label: string }[] = [
  { key: "headlineAlign", label: "Überschrift (inkl. Über- und Sub-Headline)" },
  { key: "descriptionAlign", label: "Beschreibung" },
  { key: "badgesAlign", label: "Badges" },
];

const OPTIONS: { id: StartTextAlign; title: string; Icon: typeof AlignLeft }[] = [
  { id: "left", title: "Linksbündig", Icon: AlignLeft },
  { id: "center", title: "Zentriert", Icon: AlignCenter },
];

export function StartAlignPicker({
  values,
  onChange,
}: {
  values: StartAlignValues;
  onChange: (next: StartAlignValues) => void;
}) {
  return (
    <div className="grid gap-2 rounded-xl border bg-slate-50 p-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ausrichtung im Kopfbereich</p>
        <p className="text-xs text-muted-foreground">Standard ist zentriert.</p>
      </div>
      {ROWS.map(row => {
        const current = resolveStartTextAlign(values[row.key]);
        return (
          <div key={row.key} className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium">{row.label}</span>
            <div className="grid shrink-0 grid-cols-2 gap-1 rounded-lg bg-white p-1">
              {OPTIONS.map(option => {
                const selected = option.id === current;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={selected}
                    aria-label={`${row.label}: ${option.title}`}
                    title={option.title}
                    onClick={() => onChange({ [row.key]: option.id })}
                    className={`grid place-items-center rounded-md px-2 py-1.5 transition ${selected ? "bg-[#0165c3] text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}
                  >
                    <option.Icon className="size-4" />
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
