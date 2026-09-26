import type { BenefitsTileGap } from "@shared/funnel";

const OPTIONS: Array<{ id: BenefitsTileGap; title: string; hint: string }> = [
  { id: "small", title: "Klein", hint: "Bisheriger Abstand" },
  { id: "medium", title: "Mittel", hint: "Standard, mehr Luft" },
  { id: "large", title: "Groß", hint: "Maximaler Spaltenabstand" },
];

export function BenefitsTileGapPicker({
  value,
  onChange,
}: {
  value: BenefitsTileGap;
  onChange: (gap: BenefitsTileGap) => void;
}) {
  return (
    <div className="grid gap-2 rounded-xl border bg-slate-50 p-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Abstand der zwei Spalten</p>
        <p className="text-xs text-muted-foreground">Vor allem am Smartphone: lange Wörter brauchen mehr Luft zwischen den Kacheln.</p>
      </div>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-white p-1">
        {OPTIONS.map(option => {
          const selected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              title={option.hint}
              onClick={() => onChange(option.id)}
              className={`rounded-md px-2 py-2 text-center text-xs font-bold transition ${selected ? "bg-[#0165c3] text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {option.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}
