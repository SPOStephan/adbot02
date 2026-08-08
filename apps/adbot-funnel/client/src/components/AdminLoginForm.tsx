"use client";

import { FormEvent, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AdminLoginForm() {
  const { login, loginPending, loginError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

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
        className="flex w-full max-w-md flex-col gap-6 rounded-2xl border bg-white p-8 shadow-sm"
        onSubmit={onSubmit}
      >
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Adbot Funnel Admin
          </h1>
          <p className="text-sm text-muted-foreground">
            Melde dich mit den Admin-Zugangsdaten an. Manus-Login wird nicht mehr
            verwendet.
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2 text-left">
            <Label htmlFor="admin-email">E-Mail</Label>
            <Input
              autoComplete="username"
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
      </form>
    </div>
  );
}
