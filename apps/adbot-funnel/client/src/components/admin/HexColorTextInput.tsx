import { useEffect, useState } from "react";
import { formatHexColorDraft, normalizeHexColor } from "@/lib/hexColor";
import { Input } from "@/components/ui/input";

export function HexColorTextInput({
  value,
  ariaLabel,
  className,
  onCommit,
}: {
  value: string;
  ariaLabel: string;
  className?: string;
  onCommit: (hex: string) => void;
}) {
  const [draft, setDraft] = useState(value.toUpperCase());

  useEffect(() => {
    setDraft(value.toUpperCase());
  }, [value]);

  const applyDraft = (raw: string, expandShort = false) => {
    setDraft(formatHexColorDraft(raw));
    const hex = normalizeHexColor(raw, { expandShort });
    if (hex) onCommit(hex);
  };

  return (
    <Input
      className={className ?? "h-10 min-w-0 bg-slate-50 font-mono text-sm font-semibold uppercase"}
      value={draft}
      placeholder="#0165C3 oder 0165C3"
      maxLength={16}
      spellCheck={false}
      aria-label={ariaLabel}
      title="Hexwert einkopieren, mit oder ohne #"
      onChange={event => applyDraft(event.target.value)}
      onPaste={event => {
        const hex = normalizeHexColor(event.clipboardData.getData("text/plain"), { expandShort: true });
        if (!hex) return;
        event.preventDefault();
        setDraft(hex);
        onCommit(hex);
      }}
      onBlur={() => {
        const hex = normalizeHexColor(draft, { expandShort: true });
        setDraft(hex ?? value.toUpperCase());
        if (hex) onCommit(hex);
      }}
    />
  );
}
