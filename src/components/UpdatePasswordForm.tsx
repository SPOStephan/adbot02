"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, LoaderCircle, LockKeyhole } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

export function UpdatePasswordForm() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function checkSession() {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setHasRecoverySession(Boolean(data.session));
      setCheckingSession(false);
    }

    void checkSession();
    return () => {
      active = false;
    };
  }, [supabase]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    if (password.length < 8) {
      setError("Das Passwort muss mindestens 8 Zeichen haben.");
      setLoading(false);
      return;
    }

    if (password !== passwordConfirm) {
      setError("Die Passwörter stimmen nicht überein.");
      setLoading(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError("Neues Passwort konnte nicht gespeichert werden. Bitte den Link erneut anfordern.");
      setLoading(false);
      return;
    }

    setNotice("Passwort gespeichert. Du wirst zum Dashboard weitergeleitet.");
    router.push("/dashboard");
    router.refresh();
  }

  if (checkingSession) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <LoaderCircle className="size-4 animate-spin" />
        Sitzung wird geprüft …
      </p>
    );
  }

  if (!hasRecoverySession) {
    return (
      <div className="space-y-4">
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="alert">
          Kein gültiger Zurücksetzen-Link aktiv. Bitte fordere einen neuen Link an.
        </p>
        <p className="text-center text-sm text-slate-500">
          <Link className="font-semibold text-blue-600 hover:text-blue-700" href="/passwort-vergessen">
            Passwort erneut zurücksetzen
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-700" htmlFor="password">
          Neues Passwort
        </label>
        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
          <input
            autoComplete="new-password"
            className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-slate-950 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            id="password"
            minLength={8}
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Mindestens 8 Zeichen"
            required
            type="password"
            value={password}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-700" htmlFor="passwordConfirm">
          Neues Passwort wiederholen
        </label>
        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
          <input
            autoComplete="new-password"
            className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-slate-950 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            id="passwordConfirm"
            minLength={8}
            name="passwordConfirm"
            onChange={(event) => setPasswordConfirm(event.target.value)}
            placeholder="Passwort wiederholen"
            required
            type="password"
            value={passwordConfirm}
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
        Neues Passwort speichern
        {!loading ? <ArrowRight className="size-5" /> : null}
      </button>
    </form>
  );
}
