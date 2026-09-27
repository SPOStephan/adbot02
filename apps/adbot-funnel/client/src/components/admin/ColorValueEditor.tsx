import { useEffect, useRef, useState } from "react";
import { HexColorTextInput } from "@/components/admin/HexColorTextInput";
import { Input } from "@/components/ui/input";
import { hexFromRgbDraft, hexToRgb, nextRgbDraft, normalizeHexColor } from "@/lib/hexColor";

const FALLBACK_HEX = "#10253F";

export function ColorValueEditor({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (hex: string) => void;
  ariaLabel: string;
}) {
  const hex = normalizeHexColor(value) ?? FALLBACK_HEX;
  const rgb = hexToRgb(hex) ?? { r: 16, g: 37, b: 63 };
  const [rgbDraft, setRgbDraft] = useState({ r: String(rgb.r), g: String(rgb.g), b: String(rgb.b) });
  const rgbDraftRef = useRef(rgbDraft);
  rgbDraftRef.current = rgbDraft;

  useEffect(() => {
    const parsed = hexToRgb(hex) ?? { r: 16, g: 37, b: 63 };
    const next = { r: String(parsed.r), g: String(parsed.g), b: String(parsed.b) };
    rgbDraftRef.current = next;
    setRgbDraft(next);
  }, [hex]);

  const commitRgb = (part: "r" | "g" | "b", raw: string) => {
    const nextDraft = nextRgbDraft(rgbDraftRef.current, part, raw);
    rgbDraftRef.current = nextDraft;
    setRgbDraft(nextDraft);
    const committed = hexFromRgbDraft(nextDraft);
    if (committed) onChange(committed);
  };

  return (
    <div className="grid gap-2">
      <label className="grid gap-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Hexwert</span>
        <div className="flex items-center gap-2">
          <Input
            className="h-10 w-12 shrink-0 cursor-pointer border bg-transparent p-0"
            type="color"
            value={hex}
            aria-label={`${ariaLabel} visuell auswählen`}
            onChange={event => onChange(event.target.value.toUpperCase())}
          />
          <HexColorTextInput
            value={hex}
            className="h-10 min-w-0 flex-1 bg-slate-50 font-mono text-sm font-semibold uppercase"
            ariaLabel={`${ariaLabel} als Hexwert`}
            onCommit={onChange}
          />
        </div>
      </label>
      <div className="grid grid-cols-3 gap-2">
        {(["r", "g", "b"] as const).map(part => (
          <label key={part} className="grid gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{part}</span>
            <Input
              inputMode="numeric"
              className="h-9 bg-slate-50 font-mono text-sm"
              value={rgbDraft[part]}
              maxLength={3}
              aria-label={`${ariaLabel} ${part.toUpperCase()}-Wert`}
              onChange={event => commitRgb(part, event.target.value.replace(/[^\d]/g, "").slice(0, 3))}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
