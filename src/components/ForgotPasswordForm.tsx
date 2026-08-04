"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, LoaderCircle, Mail } from "lucide-react";

import { APP_SITE_URL } from "@/lib/site-urls";
import { createClient } from "@/lib/supabase/client";

export function ForgotPasswordForm() {
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${APP_SITE_URL}/auth/callback?next=${encodeURIComponent("/passwort-neu")}`,
    });

    if (resetError) {
      setError("Zurücksetzen gerade nicht möglich. Bitte E-Mail prüfen und erneut versuchen.");
      setLoading(false);
      return;
    }

    setNotice(
      "Wenn ein Konto mit dieser E-Mail existiert, erhältst du gleich einen Link zum Zurücksetzen.",
    );
    setLoading(false);
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-700" htmlFor="email">
          E-Mail-Adresse
        </label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
          <input
            autoComplete="email"
            className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-slate-950 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            id="email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@unternehmen.de"
            required
            type="email"
            value={email}
          />
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      {notice ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
          {notice}
        </p>
      ) : null}

      <button
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={loading}
        type="submit"
      >
        {loading ? <LoaderCircle className="size-5 animate-spin" /> : null}
        Link zum Zurücksetzen senden
        {!loading ? <ArrowRight className="size-5" /> : null}
      </button>

      <p className="text-center text-sm text-slate-500">
        Zurück zur{" "}
        <Link className="font-semibold text-blue-600 hover:text-blue-700" href="/login">
          Anmeldung
        </Link>
      </p>
    </form>
  );
}
