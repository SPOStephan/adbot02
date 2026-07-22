'use client';

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowRight, LoaderCircle, LockKeyhole, Mail } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type AuthFormProps = {
  mode: "login" | "register";
  nextPath?: string;
};

export function AuthForm({ mode, nextPath = "/dashboard" }: AuthFormProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isLogin = mode === "login";
  const safeNextPath = nextPath.startsWith("/") ? nextPath : "/dashboard";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    if (isLogin) {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError("Anmeldung nicht möglich. Bitte E-Mail und Passwort prüfen.");
        setLoading(false);
        return;
      }

      router.push(safeNextPath);
      router.refresh();
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNextPath)}`,
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    if (data.session) {
      router.push(safeNextPath);
      router.refresh();
      return;
    }

    setNotice(
      "Fast geschafft: Bitte bestätige die E-Mail, die Supabase dir gerade gesendet hat.",
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

      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-700" htmlFor="password">
          Passwort
        </label>
        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
          <input
            autoComplete={isLogin ? "current-password" : "new-password"}
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
        {isLogin ? "Sicher anmelden" : "Kostenlos registrieren"}
        {!loading ? <ArrowRight className="size-5" /> : null}
      </button>

      <p className="text-center text-sm text-slate-500">
        {isLogin ? "Noch kein Konto?" : "Schon registriert?"}{" "}
        <Link
          className="font-semibold text-blue-600 hover:text-blue-700"
          href={isLogin ? "/registrieren" : "/login"}
        >
          {isLogin ? "Jetzt registrieren" : "Zur Anmeldung"}
        </Link>
      </p>
    </form>
  );
}
