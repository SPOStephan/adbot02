import type { KeyboardEvent } from "react";
import type { ChoicePage } from "@shared/funnel";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { FunnelIcon } from "./FunnelIcon";

type ChoiceStepProps = {
  page: ChoicePage;
  selected: string[];
  onSelect: (value: string) => void;
  onBack: () => void;
  onContinue: () => void;
};

export function ChoiceStep({ page, selected, onSelect, onBack, onContinue }: ChoiceStepProps) {
  const moveRadioFocus = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (page.allowMultiple || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const options = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    if (!options.length) return;
    event.preventDefault();
    const current = options.indexOf(event.currentTarget);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : ["ArrowRight", "ArrowDown"].includes(event.key) ? (current + 1) % options.length : (current - 1 + options.length) % options.length;
    const next = options[nextIndex];
    if (!next?.dataset.value) return;
    next.focus();
    onSelect(next.dataset.value);
  };
  return (
    <section className="funnel-step funnel-question-step" aria-labelledby={`${page.id}-title`}>
      <div className="funnel-question-copy">
        {page.eyebrow && <p className="funnel-eyebrow">{page.eyebrow}</p>}
        <h1 id={`${page.id}-title`} tabIndex={-1}>{page.title}</h1>
        <p id={`${page.id}-description`} className="funnel-description">{page.description}</p>
      </div>
      <div className={page.type === "choice-grid" ? "funnel-choice-grid" : "funnel-choice-list"} role={page.allowMultiple ? "group" : "radiogroup"} aria-labelledby={`${page.id}-title`} aria-describedby={`${page.id}-description`}>
        {page.options.map((option, index) => {
          const active = selected.includes(option.value);
          return (
            <button
              key={option.id}
              type="button"
              className={`funnel-choice ${active ? "is-selected" : ""}`}
              role={page.allowMultiple ? "checkbox" : "radio"}
              aria-checked={active}
              data-value={option.value}
              tabIndex={page.allowMultiple || active || (selected.length === 0 && index === 0) ? 0 : -1}
              onClick={() => onSelect(option.value)}
              onKeyDown={moveRadioFocus}
            >
              <span className="funnel-choice-icon"><FunnelIcon name={option.icon} /></span>
              <span className="funnel-choice-text"><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
              <span className="funnel-choice-check"><Check size={16} /></span>
            </button>
          );
        })}
      </div>
      <div className="funnel-step-actions">
        <button className="funnel-secondary-button" type="button" onClick={onBack}><ArrowLeft size={18} />Zurück</button>
        <button className="funnel-primary-button" type="button" onClick={onContinue} disabled={selected.length === 0}>{page.buttonLabel}<ArrowRight size={18} /></button>
      </div>
    </section>
  );
}
