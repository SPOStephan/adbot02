import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";

type YearSelectProps = {
  id: string;
  value: string;
  years: string[];
  /** Year the open list is centred on while nothing is selected. */
  startYear: string;
  placeholder: string;
  required: boolean;
  invalid: boolean;
  onChange: (value: string) => void;
};

/**
 * Year dropdown that opens centred on a start year (e.g. 1980), so people can
 * scroll towards younger and older years from there. A native <select> always
 * opens at the top while it is empty.
 */
export function YearSelect({ id, value, years, startYear, placeholder, required, invalid, onChange }: YearSelectProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(value || startYear);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const option = list?.querySelector<HTMLElement>(`[data-year="${active}"]`);
    if (list && option) list.scrollTop = option.offsetTop - list.clientHeight / 2 + option.offsetHeight / 2;
    list?.focus();
    // Only centre when the list opens; keyboard moves use scrollIntoView below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const openList = () => {
    setActive(value || startYear);
    setOpen(true);
  };
  const choose = (year: string) => {
    onChange(year);
    setOpen(false);
    buttonRef.current?.focus();
  };
  const move = (delta: number) => {
    const index = Math.max(0, years.indexOf(active));
    const next = years[Math.min(years.length - 1, Math.max(0, index + delta))];
    if (!next) return;
    setActive(next);
    listRef.current?.querySelector<HTMLElement>(`[data-year="${next}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); move(1); break;
      case "ArrowUp": event.preventDefault(); move(-1); break;
      case "PageDown": event.preventDefault(); move(10); break;
      case "PageUp": event.preventDefault(); move(-10); break;
      case "Home": event.preventDefault(); move(-years.length); break;
      case "End": event.preventDefault(); move(years.length); break;
      case "Enter":
      case " ": event.preventDefault(); choose(active); break;
      case "Escape": event.preventDefault(); setOpen(false); buttonRef.current?.focus(); break;
      case "Tab": setOpen(false); break;
    }
  };

  return (
    <div className="funnel-year-select" ref={wrapRef}>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className={value ? "funnel-year-trigger" : "funnel-year-trigger is-empty"}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-required={required}
        aria-invalid={invalid}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); openList(); }
        }}
      >
        <span>{value || placeholder || "Bitte wählen"}</span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          className="funnel-year-list"
          role="listbox"
          tabIndex={-1}
          aria-labelledby={id}
          aria-activedescendant={`${listId}-${active}`}
          onKeyDown={onListKeyDown}
        >
          {years.map(year => (
            <li
              key={year}
              id={`${listId}-${year}`}
              data-year={year}
              role="option"
              aria-selected={year === value}
              className={[year === active ? "is-active" : "", year === value ? "is-selected" : ""].filter(Boolean).join(" ") || undefined}
              onPointerEnter={() => setActive(year)}
              onClick={() => choose(year)}
            >
              {year}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
