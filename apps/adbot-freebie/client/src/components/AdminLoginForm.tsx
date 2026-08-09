import { FormEvent, useMemo, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";

export function AdminLoginForm() {
  const { login, loginPending, loginError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const ssoError = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("sso_error");
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    try {
      await login(email, password);
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "Anmeldung fehlgeschlagen.",
      );
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        className="flex w-full max-w-md flex-col gap-6 rounded-2xl border bg-white p-8 shadow-sm"
        onSubmit={onSubmit}
      >
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Adbot Freebie Admin
          </h1>
          <p className="text-sm text-muted-foreground">
            Kunden melden sich über das Adbot-Dashboard per SSO an. Plattform-Admin
            hier per Passwort.
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2 text-left">
            <label className="text-sm font-medium" htmlFor="admin-email">
              E-Mail
            </label>
            <input
              autoComplete="username"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              id="admin-email"
              onChange={event => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </div>
          <div className="space-y-2 text-left">
            <label className="text-sm font-medium" htmlFor="admin-password">
              Passwort
            </label>
            <input
              autoComplete="current-password"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              id="admin-password"
              onChange={event => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </div>
        </div>

        {(localError || loginError || ssoError) && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">
            {localError ?? loginError?.message ?? `SSO: ${ssoError}`}
          </p>
        )}

        <button
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          disabled={loginPending}
          type="submit"
        >
          {loginPending ? "Anmelden…" : "Anmelden"}
        </button>
      </form>
    </div>
  );
}
