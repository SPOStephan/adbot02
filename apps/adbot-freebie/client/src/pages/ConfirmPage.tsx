import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";

function readToken() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("token") ?? "";
}

export function ConfirmPage() {
  const [token] = useState(readToken);
  const confirmMutation = trpc.public.confirmDoi.useMutation();
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    void confirmMutation.mutateAsync({ token });
  }, [token, confirmMutation]);

  if (!token) {
    return <Shell>Bestätigungslink unvollständig.</Shell>;
  }

  if (confirmMutation.isPending) {
    return <Shell>Bestätige E-Mail…</Shell>;
  }

  if (confirmMutation.error) {
    return <Shell>{confirmMutation.error.message}</Shell>;
  }

  const data = confirmMutation.data;
  if (!data) return <Shell>Bestätige E-Mail…</Shell>;

  return (
    <Shell>
      <p className="brand text-4xl">Adbot Freebie</p>
      <h1 className="mt-4 text-2xl font-semibold">{data.title}</h1>
      <p className="mt-3 text-[var(--muted)]">E-Mail bestätigt — dein Freebie ist bereit.</p>
      <a
        className="mt-8 inline-flex rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white"
        href={data.downloadUrl}
        rel="noopener noreferrer"
        target="_blank"
      >
        Freebie herunterladen
      </a>
    </Shell>
  );
}

function Shell({ children }: { children: import("react").ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      {children}
    </main>
  );
}
