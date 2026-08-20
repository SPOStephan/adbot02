import { trpc } from "@/lib/trpc";
import { loadMetaPixel, trackMetaConversion } from "@/lib/metaPixel";
import { getBrowserHostname, isSharedFreebieHost } from "@/lib/freebieHost";
import { useEffect, useState, type ReactNode } from "react";
import { useRoute } from "wouter";

type PublicOffer = {
  slug: string;
  title: string;
  description: string;
  confirmationMode: "doi" | "otp";
  hasFile: boolean;
  metaTracking: {
    enabled: boolean;
    pixelId: string;
    eventName: string;
  };
};

export function OfferPage() {
  const [, params] = useRoute("/o/:slug");
  const slug = params?.slug ?? "";
  return <OfferView slug={slug} enabled={Boolean(slug)} />;
}

/** Custom-domain root: Host → READY published Freebie. */
export function HostBoundOffer() {
  const hostname = getBrowserHostname();
  const shared = isSharedFreebieHost(hostname);
  const query = trpc.public.offerByHost.useQuery(
    { hostname },
    { enabled: Boolean(hostname) && !shared },
  );

  if (shared || !hostname) {
    return <HomeFallback />;
  }

  if (query.isLoading) {
    return <PublicShell>Lade Freebie…</PublicShell>;
  }

  if (query.error || !query.data) {
    return (
      <PublicShell>
        <p className="funnel-eyebrow">Custom Domain</p>
        <h1>Kein Freebie verbunden</h1>
        <p className="funnel-description">
          Diese Domain ist noch nicht mit einem veröffentlichten Freebie verknüpft,
          oder DNS/SSL ist noch nicht fertig.
        </p>
      </PublicShell>
    );
  }

  return <OfferView slug={query.data.slug} enabled offer={query.data} />;
}

function HomeFallback() {
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
        <section className="funnel-step funnel-start-step">
          <div className="funnel-copy">
            <p className="funnel-eyebrow">Adbot Freebie</p>
            <h1>Lead-Magnete mit DOI oder OTP.</h1>
            <p className="funnel-description">
              Lade dein Freebie hoch, wähle Bestätigung per Link oder Code und liefere
              nach E-Mail-Bestätigung über Bunny CDN aus.
            </p>
            <div className="mt-8">
              <a className="funnel-primary-button" href="/admin">
                Admin öffnen
              </a>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function OfferView({
  slug,
  enabled,
  offer: prefetched,
}: {
  slug: string;
  enabled: boolean;
  offer?: PublicOffer;
}) {
  const offerQuery = trpc.public.offer.useQuery(
    { slug },
    { enabled: enabled && !prefetched && Boolean(slug) },
  );
  const captureMutation = trpc.public.capture.useMutation();
  const confirmOtpMutation = trpc.public.confirmOtp.useMutation();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [leadId, setLeadId] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const offer = prefetched ?? offerQuery.data;
  useEffect(() => {
    if (offer?.metaTracking?.enabled && offer.metaTracking.pixelId) {
      loadMetaPixel(offer.metaTracking.pixelId);
    }
  }, [offer?.metaTracking?.enabled, offer?.metaTracking?.pixelId]);

  if (!prefetched && offerQuery.isLoading) {
    return <PublicShell>Lade Freebie…</PublicShell>;
  }

  if ((!prefetched && offerQuery.error) || !offer) {
    return <PublicShell>Dieses Freebie ist nicht verfügbar.</PublicShell>;
  }

  const trackLead = () => {
    if (offer.metaTracking?.enabled && offer.metaTracking.pixelId) {
      trackMetaConversion(
        offer.metaTracking.pixelId,
        offer.metaTracking.eventName || "Lead",
      );
    }
  };

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
            trackLead();
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
          const result = await captureMutation.mutateAsync({ slug: offer.slug, email });
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
