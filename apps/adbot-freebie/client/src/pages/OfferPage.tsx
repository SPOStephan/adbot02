import { useState, type ReactNode } from "react";
import { useRoute } from "wouter";
import { trpc } from "@/lib/trpc";

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
    return <Shell>Lade Freebie…</Shell>;
  }

  if (offerQuery.error || !offerQuery.data) {
    return <Shell>Dieses Freebie ist nicht verfügbar.</Shell>;
  }

  const offer = offerQuery.data;

  if (downloadUrl) {
    return (
      <Shell>
        <p className="brand text-4xl">Adbot Freebie</p>
        <h1 className="mt-4 text-2xl font-semibold">{offer.title}</h1>
        <p className="mt-3 text-[var(--muted)]">Deine Bestätigung war erfolgreich.</p>
        <a
          className="mt-8 inline-flex rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white"
          href={downloadUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          Freebie herunterladen
        </a>
      </Shell>
    );
  }

  if (leadId && offer.confirmationMode === "otp") {
    return (
      <Shell>
        <p className="brand text-4xl">Adbot Freebie</p>
        <h1 className="mt-4 text-2xl font-semibold">Code eingeben</h1>
        <p className="mt-3 text-[var(--muted)]">
          Wir haben dir einen 6-stelligen Code für „{offer.title}“ geschickt.
        </p>
        <form
          className="mt-8 flex max-w-md flex-col gap-3"
          onSubmit={async event => {
            event.preventDefault();
            const result = await confirmOtpMutation.mutateAsync({ leadId, otp });
            setDownloadUrl(result.downloadUrl);
          }}
        >
          <input
            className="rounded-xl border border-[var(--line)] bg-white px-4 py-3 outline-none ring-[var(--accent)] focus:ring-2"
            inputMode="numeric"
            maxLength={8}
            onChange={event => setOtp(event.target.value)}
            placeholder="123456"
            value={otp}
          />
          <button
            className="rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
            disabled={confirmOtpMutation.isPending || otp.trim().length < 4}
            type="submit"
          >
            Bestätigen
          </button>
          {confirmOtpMutation.error ? (
            <p className="text-sm text-[var(--danger)]">{confirmOtpMutation.error.message}</p>
          ) : null}
        </form>
      </Shell>
    );
  }

  if (leadId && offer.confirmationMode === "doi") {
    return (
      <Shell>
        <p className="brand text-4xl">Adbot Freebie</p>
        <h1 className="mt-4 text-2xl font-semibold">Bitte E-Mail bestätigen</h1>
        <p className="mt-3 text-[var(--muted)]">
          Wir haben dir einen Bestätigungslink für „{offer.title}“ geschickt. Nach dem Klick
          erhältst du dein Freebie.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="brand text-4xl">Adbot Freebie</p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">{offer.title}</h1>
      {offer.description ? (
        <p className="mt-4 max-w-xl text-base leading-7 text-[var(--muted)]">{offer.description}</p>
      ) : null}
      <form
        className="mt-8 flex max-w-md flex-col gap-3"
        onSubmit={async event => {
          event.preventDefault();
          const result = await captureMutation.mutateAsync({ slug, email });
          setLeadId(result.leadId);
        }}
      >
        <label className="text-sm font-medium text-[var(--ink)]" htmlFor="email">
          E-Mail
        </label>
        <input
          className="rounded-xl border border-[var(--line)] bg-white px-4 py-3 outline-none ring-[var(--accent)] focus:ring-2"
          id="email"
          onChange={event => setEmail(event.target.value)}
          placeholder="name@firma.de"
          required
          type="email"
          value={email}
        />
        <button
          className="rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
          disabled={captureMutation.isPending || !offer.hasFile}
          type="submit"
        >
          Freebie anfordern
        </button>
        {!offer.hasFile ? (
          <p className="text-sm text-[var(--danger)]">Datei noch nicht hinterlegt.</p>
        ) : null}
        {captureMutation.error ? (
          <p className="text-sm text-[var(--danger)]">{captureMutation.error.message}</p>
        ) : null}
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      {children}
    </main>
  );
}
