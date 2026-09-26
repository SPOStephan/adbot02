import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { HexColorTextInput } from "@/components/admin/HexColorTextInput";
import { hexToRgb, parseRgbComponent, rgbToHex } from "@/lib/hexColor";

export function IconColorField({
  label,
  value,
  brandColor,
  onChange,
}: {
  label: string;
  value?: string;
  brandColor: string;
  onChange: (value: string | undefined) => void;
}) {
  const resolved = value || brandColor;
  const usingBrand = !value;
  const rgb = hexToRgb(resolved) ?? { r: 1, g: 101, b: 195 };
  const [rgbDraft, setRgbDraft] = useState({ r: String(rgb.r), g: String(rgb.g), b: String(rgb.b) });

  useEffect(() => {
    const next = (value || brandColor).toUpperCase();
    const parsed = hexToRgb(next) ?? { r: 1, g: 101, b: 195 };
    setRgbDraft({ r: String(parsed.r), g: String(parsed.g), b: String(parsed.b) });
  }, [value, brandColor]);

  const commitRgb = (part: "r" | "g" | "b", raw: string) => {
    const nextDraft = { ...rgbDraft, [part]: raw };
    setRgbDraft(nextDraft);
    const parsed = {
      r: parseRgbComponent(nextDraft.r),
      g: parseRgbComponent(nextDraft.g),
      b: parseRgbComponent(nextDraft.b),
    };
    if (parsed.r === null || parsed.g === null || parsed.b === null) return;
    onChange(rgbToHex(parsed.r, parsed.g, parsed.b));
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {usingBrand
          ? <span className="text-[11px] font-medium text-muted-foreground">Brandingfarbe</span>
          : <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => onChange(undefined)}>Branding verwenden</Button>}
      </div>
      <div className="grid gap-2 rounded-xl border bg-white p-2">
        <div className="flex items-center gap-2">
          <Input className="h-10 w-12 shrink-0 cursor-pointer border-0 bg-transparent p-0" type="color" value={resolved} aria-label={`${label} visuell auswählen`} onChange={event => onChange(event.target.value.toUpperCase())} />
          <HexColorTextInput value={resolved} ariaLabel={`${label} als Hexwert`} onCommit={onChange} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(["r", "g", "b"] as const).map(part => (
            <label key={part} className="grid gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{part}</span>
              <Input inputMode="numeric" className="h-9 bg-slate-50 font-mono text-sm" value={rgbDraft[part]} maxLength={3} aria-label={`${label} ${part.toUpperCase()}-Wert`} onChange={event => commitRgb(part, event.target.value.replace(/[^\d]/g, "").slice(0, 3))} />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
