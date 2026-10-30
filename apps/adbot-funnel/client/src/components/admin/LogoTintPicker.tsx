import type { LogoTint } from "@shared/funnel";
import { LOGO_TINT_META, logoTintFilter, resolveLogoTint } from "@shared/funnelHeader";

/** Original / Weiß / Dunkel for the funnel logo. */
export function LogoTintPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: LogoTint;
  onChange: (tint: LogoTint) => void;
}) {
  const current = resolveLogoTint(value);
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="grid grid-cols-3 gap-1 rounded-lg border bg-white p-1">
        {LOGO_TINT_META.map(option => {
          const selected = option.id === current;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              title={option.description}
              onClick={() => onChange(option.id)}
              className={`rounded-md px-2 py-1.5 text-xs font-semibold transition ${selected ? "bg-[#0165c3] text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {option.title}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">Weiß/Dunkel färbt alle sichtbaren Pixel ein. Klappt mit PNG oder WebP mit transparentem Hintergrund; ein JPG würde zur einfarbigen Fläche.</p>
    </div>
  );
}

/** Small logo preview on a background that keeps a white-tinted logo visible. */
export function LogoPreviewTile({ url, alt, tint }: { url: string; alt: string; tint?: LogoTint }) {
  const resolved = resolveLogoTint(tint);
  const filter = logoTintFilter(resolved);
  return (
    <div className={`grid h-16 place-items-center overflow-hidden rounded-2xl border px-2 shadow-sm ${resolved === "white" ? "bg-[#0165c3]" : "bg-white"}`}>
      <img className="max-h-12 max-w-full object-contain" src={url} alt={alt} style={filter ? { filter } : undefined} />
    </div>
  );
}
