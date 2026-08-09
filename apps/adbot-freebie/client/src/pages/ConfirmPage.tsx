import { trpc } from "@/lib/trpc";
import { useEffect, useRef, useState, type ReactNode } from "react";

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
    return <PublicShell>Bestätigungslink unvollständig.</PublicShell>;
  }

  if (confirmMutation.isPending || (!confirmMutation.data && !confirmMutation.error)) {
    return <PublicShell>Bestätige E-Mail…</PublicShell>;
  }

  if (confirmMutation.error) {
    return <PublicShell>{confirmMutation.error.message}</PublicShell>;
  }

  const data = confirmMutation.data!;

  return (
    <PublicShell>
      <p className="funnel-eyebrow">Adbot Freebie</p>
      <h1>{data.title}</h1>
      <p className="funnel-description">E-Mail bestätigt — dein Freebie ist bereit.</p>
      <div className="mt-8">
        <a
          className="funnel-primary-button"
          href={data.downloadUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          Freebie herunterladen
        </a>
      </div>
    </PublicShell>
  );
}

function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="funnel-canvas">
      <header className="funnel-header">
        <div className="funnel-wordmark">
          <span className="funnel-wordmark-mark" aria-hidden="true">
            AF
          </span>
          Adbot Freebie
        </div>
      </header>
      <main className="funnel-main">
        <section className="funnel-step">
          <div className="funnel-copy">{children}</div>
        </section>
      </main>
    </div>
  );
}
