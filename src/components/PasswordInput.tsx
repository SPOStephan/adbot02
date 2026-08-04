"use client";

import { useId, useState, type ReactNode } from "react";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";

type PasswordInputProps = {
  id?: string;
  name?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  placeholder?: string;
  minLength?: number;
  required?: boolean;
  labelAside?: ReactNode;
};

export function PasswordInput({
  id,
  name = "password",
  label,
  value,
  onChange,
  autoComplete,
  placeholder = "Mindestens 8 Zeichen",
  minLength = 8,
  required = true,
  labelAside,
}: PasswordInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-semibold text-slate-700" htmlFor={inputId}>
          {label}
        </label>
        {labelAside}
      </div>
      <div className="relative">
        <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
        <input
          autoComplete={autoComplete}
          className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-11 pr-12 text-slate-950 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          id={inputId}
          minLength={minLength}
          name={name}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
          type={visible ? "text" : "password"}
          value={value}
        />
        <button
          aria-label={visible ? "Passwort verbergen" : "Passwort anzeigen"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 grid w-12 place-items-center text-slate-400 transition hover:text-slate-700"
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          {visible ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
        </button>
      </div>
    </div>
  );
}
