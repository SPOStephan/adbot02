import { trpc } from "@/lib/trpc";
import { useState, type ReactNode } from "react";
import { useRoute } from "wouter";

export function OfferPage() {
  const [, params] = useRoute("/o/:slug");
  const slug = params?.slug ?? "";
  const offerQuery = trpc.public.offer.useQuery({ slug }, { enabled: Boolean(slug) });
  const captureMutation = trpc.public.capture.useMutation();
  const confirmOtpMutation = trpc.public.confirmOtp.useMutation();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [leadId, setLeadId] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  if (offerQuery.isLoading) {
    return <PublicShell>Lade Freebie…</PublicShell>;
  }

  if (offerQuery.error || !offerQuery.data) {
    return <PublicShell>Dieses Freebie ist nicht verfügbar.</PublicShell>;
  }

  const offer = offerQuery.data;

  if (downloadUrl) {
    return (
      <PublicShell>
        <p className="funnel-eyebrow">Adbot Freebie</p>
        <h1>{offer.title}</h1>
        <p className="funnel-description">Deine Bestätigung war erfolgreich.</p>
        <div className="mt-8">
          <a
            className="funnel-primary-button"
            href={downloadUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            Freebie herunterladen
          </a>
        </div>
      </PublicShell>
    );
  }

  if (leadId && offer.confirmationMode === "otp") {
    return (
      <PublicShell>
        <p className="funnel-eyebrow">Code eingeben</p>
        <h1>Bestätigungscode</h1>
        <p className="funnel-description">
          Wir haben dir einen 6-stelligen Code für „{offer.title}“ geschickt.
        </p>
        <form
          className="funnel-contact-form"
          onSubmit={async event => {
            event.preventDefault();
            const result = await confirmOtpMutation.mutateAsync({ leadId, otp });
            setDownloadUrl(result.downloadUrl);
          }}
        >
          <div className="funnel-field-grid">
            <label className="funnel-field">
              Code
              <input
                inputMode="numeric"
                maxLength={8}
                onChange={event => setOtp(event.target.value)}
                placeholder="123456"
                value={otp}
              />
            </label>
            <button
              className="funnel-primary-button"
              disabled={confirmOtpMutation.isPending || otp.trim().length < 4}
              type="submit"
            >
              Bestätigen
            </button>
            {confirmOtpMutation.error ? (
              <p className="funnel-form-error">{confirmOtpMutation.error.message}</p>
            ) : null}
          </div>
        </form>
      </PublicShell>
    );
  }

  if (leadId && offer.confirmationMode === "doi") {
    return (
      <PublicShell>
        <p className="funnel-eyebrow">E-Mail prüfen</p>
        <h1>Bitte E-Mail bestätigen</h1>
        <p className="funnel-description">
          Wir haben dir einen Bestätigungslink für „{offer.title}“ geschickt. Nach dem
          Klick erhältst du dein Freebie.
        </p>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      <p className="funnel-eyebrow">Adbot Freebie</p>
      <h1>{offer.title}</h1>
      {offer.description ? (
        <p className="funnel-description">{offer.description}</p>
      ) : null}
      <form
        className="funnel-contact-form"
        onSubmit={async event => {
          event.preventDefault();
          const result = await captureMutation.mutateAsync({ slug, email });
          setLeadId(result.leadId);
        }}
      >
        <div className="funnel-field-grid">
          <label className="funnel-field">
            E-Mail<em>*</em>
            <input
              onChange={event => setEmail(event.target.value)}
              placeholder="name@firma.de"
              required
              type="email"
              value={email}
            />
          </label>
          <button
            className="funnel-primary-button"
            disabled={captureMutation.isPending || !offer.hasFile}
            type="submit"
          >
            Freebie anfordern
          </button>
          {!offer.hasFile ? (
            <p className="funnel-form-error">Datei noch nicht hinterlegt.</p>
          ) : null}
          {captureMutation.error ? (
            <p className="funnel-form-error">{captureMutation.error.message}</p>
          ) : null}
        </div>
      </form>
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
