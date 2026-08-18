"use client";

import { Plus, Trash2 } from "lucide-react";

import { MAX_CREATIVE_TEXT_VARIANTS } from "@/lib/meta/creative-text-variants";

type Props = {
  label: string;
  hint: string;
  values: string[];
  onChange: (next: string[]) => void;
  maxLength: number;
  recommended: number;
  optional?: boolean;
  disabled?: boolean;
  multiline?: boolean;
  inputClass: string;
  lengthHint: (value: string, recommended: number, max: number) => string;
};

export function CreativeTextVariantFields({
  label,
  hint,
  values,
  onChange,
  maxLength,
  recommended,
  optional = false,
  disabled = false,
  multiline = false,
  inputClass,
  lengthHint,
}: Props) {
  const slots = values.length > 0 ? values : [""];
  const canAdd = slots.length < MAX_CREATIVE_TEXT_VARIANTS && !disabled;

  function updateAt(index: number, value: string) {
    const next = [...slots];
    next[index] = value;
    onChange(next);
  }

  function removeAt(index: number) {
    if (slots.length <= 1) {
      onChange([""]);
      return;
    }
    onChange(slots.filter((_, i) => i !== index));
  }

  function addSlot() {
    if (!canAdd) return;
    onChange([...slots, ""]);
  }

  return (
    <div className="lg:col-span-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="text-sm font-bold text-slate-800">
          {label}{" "}
          {optional ? (
            <span className="font-medium text-slate-500">(optional)</span>
          ) : null}
        </p>
        <p className="text-xs font-medium text-slate-500">
          Bis zu {MAX_CREATIVE_TEXT_VARIANTS} Varianten · {hint}
        </p>
      </div>
      <ul className="mt-2 space-y-3">
        {slots.map((value, index) => (
          <li key={`variant-${index}`}>
            <div className="flex items-start gap-2">
              <span className="mt-3 w-6 shrink-0 text-xs font-bold text-slate-400">
                {index + 1}.
              </span>
              <div className="min-w-0 flex-1">
                {multiline ? (
                  <textarea
                    className={`${inputClass} min-h-24 resize-y`}
                    disabled={disabled}
                    maxLength={maxLength}
                    onChange={(event) => updateAt(index, event.target.value)}
                    required={!optional && index === 0}
                    value={value}
                  />
                ) : (
                  <input
                    className={inputClass}
                    disabled={disabled}
                    maxLength={maxLength}
                    onChange={(event) => updateAt(index, event.target.value)}
                    required={!optional && index === 0}
                    value={value}
                  />
                )}
                <span className="mt-1 block text-xs font-medium text-slate-500">
                  {lengthHint(value, recommended, maxLength)}
                </span>
              </div>
              {slots.length > 1 || value ? (
                <button
                  aria-label={`${label} Variante ${index + 1} entfernen`}
                  className="mt-2 inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-rose-700 disabled:opacity-40"
                  disabled={disabled}
                  onClick={() => removeAt(index)}
                  type="button"
                >
                  <Trash2 className="size-4" />
                </button>
              ) : (
                <span className="size-9 shrink-0" />
              )}
            </div>
          </li>
        ))}
      </ul>
      {canAdd ? (
        <button
          className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          disabled={disabled}
          onClick={addSlot}
          type="button"
        >
          <Plus className="size-3.5" />
          Variante hinzufügen
        </button>
      ) : null}
    </div>
  );
}
