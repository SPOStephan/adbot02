"use client";

import { FormEvent, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getBrowserHostname } from "@/lib/funnelHost";
import { portalFunnelSsoUrl } from "@/lib/portalUrl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  nextPath?: string;
  ssoError?: string | null;
};

/** Schlichtes Login-Fenster: Logo aus den Funnels dieser Domain, E-Mail und Passwort. */
export function AdminLoginForm({ nextPath = "/admin", ssoError = null }: Props) {
  const { login, loginPending, loginError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const portalHref = portalFunnelSsoUrl(nextPath);
  const hostname = getBrowserHostname();
  const brandingQuery = trpc.members.loginBranding.useQuery(
    { hostname },
    { enabled: Boolean(hostname), retry: false, refetchOnWindowFocus: false },
  );
  const branding = brandingQuery.data ?? null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    try {
      await login(email, password);
    } catch (error) {
      setLocalError(
        error instanceof Error
          ? error.message
          : "Anmeldung fehlgeschlagen.",
      );
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form
        className="flex w-full max-w-sm flex-col gap-6 rounded-2xl border bg-white p-8 shadow-sm"
        onSubmit={onSubmit}
      >
        <div className="flex min-h-12 items-center justify-center">
          {branding ? (
            <img
              alt={branding.logoAlt}
              className="max-h-16 max-w-[220px] object-contain"
              src={branding.logoUrl}
            />
          ) : brandingQuery.isLoading ? null : (
            <h1 className="text-2xl font-semibold tracking-tight">Anmelden</h1>
          )}
        </div>

        {ssoError ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">
            {ssoError}
          </p>
        ) : null}

        <div className="space-y-4">
          <div className="space-y-2 text-left">
            <Label htmlFor="admin-email">E-Mail</Label>
            <Input
              autoComplete="username"
              autoFocus
              id="admin-email"
              onChange={event => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </div>
          <div className="space-y-2 text-left">
            <Label htmlFor="admin-password">Passwort</Label>
            <Input
              autoComplete="current-password"
              id="admin-password"
              onChange={event => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </div>
        </div>

        {(localError || loginError) && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">
            {localError ?? loginError?.message}
          </p>
        )}

        <Button className="w-full" disabled={loginPending} size="lg" type="submit">
          {loginPending ? "Anmelden…" : "Anmelden"}
        </Button>

        <a className="text-center text-xs text-muted-foreground underline-offset-4 hover:underline" href={portalHref}>
          Mit Adbot-Konto anmelden
        </a>
      </form>
    </div>
  );
}
