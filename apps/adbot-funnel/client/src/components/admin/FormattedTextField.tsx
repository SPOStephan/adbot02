import { useEffect, useRef } from "react";
import { Bold, Italic, Underline } from "lucide-react";
import { normalizeCssColor, sanitizeFormattedText } from "@shared/formattedText";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function runCommand(command: string, value?: string) {
  document.execCommand(command, false, value);
}

function unwrapColorSpans(root: ParentNode) {
  for (const span of [...root.querySelectorAll("span")]) {
    if (!/(?:^|;)\s*color\s*:/i.test(span.getAttribute("style") || "")) continue;
    const parent = span.parentNode;
    if (!parent) continue;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
  }
}

function wrapNodeContents(parent: Node, wrapper: HTMLElement) {
  while (parent.firstChild) wrapper.appendChild(parent.firstChild);
  parent.appendChild(wrapper);
}

export function wrapSelectionInColor(color: string, editor?: HTMLElement | null) {
  const hex = normalizeCssColor(color);
  if (!hex) return;
  const selection = window.getSelection();
  const applyToEditor = () => {
    if (!editor) return;
    unwrapColorSpans(editor);
    if (!editor.childNodes.length) return;
    const span = document.createElement("span");
    span.style.color = hex;
    wrapNodeContents(editor, span);
  };
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    applyToEditor();
    return;
  }
  const range = selection.getRangeAt(0);
  if (editor && !editor.contains(range.commonAncestorContainer)) {
    applyToEditor();
    return;
  }
  const span = document.createElement("span");
  span.style.color = hex;
  try {
    const contents = range.extractContents();
    unwrapColorSpans(contents);
    span.appendChild(contents);
    range.insertNode(span);
  } catch {
    applyToEditor();
    return;
  }
  selection.removeAllRanges();
  const next = document.createRange();
  next.selectNodeContents(span);
  selection.addRange(next);
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

export function plainTextFromClipboard(data: DataTransfer | null | undefined): string {
  if (!data) return "";
  return data.getData("text/plain").replace(/\r\n/g, "\n").replace(/\u00A0/g, " ");
}

export function insertPlainTextAtSelection(editor: HTMLElement, text: string) {
  editor.focus();
  if (text && document.queryCommandSupported("insertText") && document.execCommand("insertText", false, text)) {
    return;
  }
  const selection = window.getSelection();
  const range = selection && selection.rangeCount > 0 && editor.contains(selection.getRangeAt(0).commonAncestorContainer)
    ? selection.getRangeAt(0)
    : (() => {
      const next = document.createRange();
      next.selectNodeContents(editor);
      next.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(next);
      return next;
    })();
  range.deleteContents();
  const fragment = document.createDocumentFragment();
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (index > 0) fragment.appendChild(document.createElement("br"));
    if (line) fragment.appendChild(document.createTextNode(line));
  });
  if (!fragment.childNodes.length) return;
  const last = fragment.lastChild;
  range.insertNode(fragment);
  if (last && selection) {
    const after = document.createRange();
    after.setStartAfter(last);
    after.collapse(true);
    selection.removeAllRanges();
    selection.addRange(after);
  }
}

function isEditingNode(node: HTMLElement) {
  if (document.activeElement === node) return true;
  const selection = window.getSelection();
  return Boolean(selection?.anchorNode && node.contains(selection.anchorNode));
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
    if (isEditingNode(node)) return;
    const next = value || "";
    if (node.innerHTML !== next) node.innerHTML = next;
  }, [value]);

  const commit = () => {
    if (!ref.current) return;
    const next = sanitizeFormattedText(ref.current.innerHTML);
    if (ref.current.innerHTML !== next) ref.current.innerHTML = next;
    onChange(next);
  };

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
            commit();
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
              wrapSelectionInColor(event.target.value, ref.current);
              ref.current?.focus();
              commit();
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
        onPaste={event => {
          event.preventDefault();
          const editor = ref.current;
          if (!editor) return;
          insertPlainTextAtSelection(editor, plainTextFromClipboard(event.clipboardData));
          onChange(sanitizeFormattedText(editor.innerHTML));
        }}
        onInput={() => {
          if (!ref.current) return;
          onChange(ref.current.innerHTML);
        }}
        onBlur={() => {
          commit();
        }}
      />
    </div>
  );
}
