import { useEffect, useRef } from "react";
import { Bold, Italic, Underline } from "lucide-react";
import { sanitizeFormattedText } from "@shared/formattedText";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function runCommand(command: string, value?: string) {
  document.execCommand(command, false, value);
}

function wrapSelectionInSmall() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const existing = range.commonAncestorContainer instanceof Element
    ? range.commonAncestorContainer.closest("small")
    : range.commonAncestorContainer.parentElement?.closest("small");
  if (existing) {
    const parent = existing.parentNode;
    if (!parent) return;
    while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
    parent.removeChild(existing);
    return;
  }
  const small = document.createElement("small");
  try {
    range.surroundContents(small);
  } catch {
    small.appendChild(range.extractContents());
    range.insertNode(small);
  }
  selection.removeAllRanges();
  const next = document.createRange();
  next.selectNodeContents(small);
  selection.addRange(next);
}

export function FormattedTextField({
  value,
  onChange,
  rows = 2,
  placeholder,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  "aria-label"?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (document.activeElement === node) return;
    const next = value || "";
    if (node.innerHTML !== next) node.innerHTML = next;
  }, [value]);

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <Button type="button" size="sm" variant="outline" className="h-8 px-2" aria-label="Fett" onMouseDown={event => event.preventDefault()} onClick={() => { runCommand("bold"); ref.current?.focus(); }}>
          <Bold className="size-3.5" />
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 px-2" aria-label="Kursiv" onMouseDown={event => event.preventDefault()} onClick={() => { runCommand("italic"); ref.current?.focus(); }}>
          <Italic className="size-3.5" />
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 px-2" aria-label="Unterstrichen" onMouseDown={event => event.preventDefault()} onClick={() => { runCommand("underline"); ref.current?.focus(); }}>
          <Underline className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 px-2"
          aria-label="Kleiner"
          title="Markierten Zusatz kleiner setzen, zum Beispiel (m/w/d)"
          onMouseDown={event => event.preventDefault()}
          onClick={() => {
            wrapSelectionInSmall();
            ref.current?.focus();
            if (ref.current) onChange(sanitizeFormattedText(ref.current.innerHTML));
          }}
        >
          <span className="text-[11px] font-bold leading-none">Klein</span>
        </Button>
        <label className="inline-flex h-8 items-center gap-1 rounded-md border bg-white px-2 text-xs font-semibold">
          Farbe
          <Input
            className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0"
            type="color"
            aria-label="Schriftfarbe für die Auswahl"
            defaultValue="#10253f"
            onMouseDown={event => event.preventDefault()}
            onChange={event => {
              runCommand("foreColor", event.target.value);
              ref.current?.focus();
              if (ref.current) onChange(sanitizeFormattedText(ref.current.innerHTML));
            }}
          />
        </label>
      </div>
      <div
        ref={ref}
        className="formatted-text-field"
        contentEditable
        role="textbox"
        aria-multiline={rows > 1}
        aria-label={ariaLabel}
        data-placeholder={placeholder ?? ""}
        style={{ minHeight: `${Math.max(2, rows) * 1.5 + 1.2}rem` }}
        suppressContentEditableWarning
        onInput={() => {
          if (!ref.current) return;
          onChange(ref.current.innerHTML);
        }}
        onBlur={() => {
          if (!ref.current) return;
          const next = sanitizeFormattedText(ref.current.innerHTML);
          if (ref.current.innerHTML !== next) ref.current.innerHTML = next;
          onChange(next);
        }}
      />
    </div>
  );
}
