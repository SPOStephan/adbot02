import { useMemo, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";

type Draft = {
  title: string;
  description: string;
  confirmationMode: "doi" | "otp";
  isPublished: boolean;
};

const emptyDraft: Draft = {
  title: "",
  description: "",
  confirmationMode: "doi",
  isPublished: false,
};

export function AdminPage() {
  const meQuery = trpc.auth.me.useQuery();
  const loginMutation = trpc.auth.login.useMutation();
  const logoutMutation = trpc.auth.logout.useMutation();
  const utils = trpc.useUtils();
  const offersQuery = trpc.freebies.list.useQuery(undefined, {
    enabled: Boolean(meQuery.data),
  });
  const upsertMutation = trpc.freebies.upsert.useMutation({
    onSuccess: async () => {
      await utils.freebies.list.invalidate();
      setDraft(emptyDraft);
      setEditingId(null);
    },
  });
  const uploadMutation = trpc.freebies.uploadAsset.useMutation({
    onSuccess: async () => utils.freebies.list.invalidate(),
  });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const leadsQuery = trpc.freebies.leads.useQuery(
    { offerId: selectedOfferId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(selectedOfferId) },
  );

  const ssoError = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("sso_error");
  }, []);

  if (meQuery.isLoading) {
    return <AdminShell>Lade Session…</AdminShell>;
  }

  if (!meQuery.data) {
    return (
      <AdminShell>
        <p className="brand text-4xl">Adbot Freebie</p>
        <h1 className="mt-3 text-2xl font-semibold">Admin-Login</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Kunden melden sich über das Adbot-Dashboard per SSO an. Plattform-Admin hier per Passwort.
        </p>
        {ssoError ? (
          <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-[var(--danger)]">
            SSO: {ssoError}
          </p>
        ) : null}
        <form
          className="mt-8 flex max-w-md flex-col gap-3"
          onSubmit={async event => {
            event.preventDefault();
            await loginMutation.mutateAsync({ email, password });
            await meQuery.refetch();
          }}
        >
          <input
            className="rounded-xl border border-[var(--line)] bg-white px-4 py-3"
            onChange={event => setEmail(event.target.value)}
            placeholder="admin@example.com"
            type="email"
            value={email}
          />
          <input
            className="rounded-xl border border-[var(--line)] bg-white px-4 py-3"
            onChange={event => setPassword(event.target.value)}
            placeholder="Passwort"
            type="password"
            value={password}
          />
          <button
            className="rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white"
            disabled={loginMutation.isPending}
            type="submit"
          >
            Anmelden
          </button>
          {loginMutation.error ? (
            <p className="text-sm text-[var(--danger)]">{loginMutation.error.message}</p>
          ) : null}
        </form>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="brand text-4xl">Adbot Freebie</p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Angemeldet als {meQuery.data.email}
            {meQuery.data.loginMethod === "adbot-sso" ? " (SSO)" : " (Admin)"}
          </p>
        </div>
        <button
          className="rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm font-medium"
          onClick={async () => {
            await logoutMutation.mutateAsync();
            await meQuery.refetch();
          }}
          type="button"
        >
          Abmelden
        </button>
      </div>

      <section className="mt-10 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[var(--shadow)]">
        <h2 className="text-xl font-semibold">
          {editingId ? "Freebie bearbeiten" : "Neues Freebie"}
        </h2>
        <form
          className="mt-5 grid gap-3"
          onSubmit={async event => {
            event.preventDefault();
            await upsertMutation.mutateAsync({
              id: editingId ?? undefined,
              ...draft,
            });
          }}
        >
          <input
            className="rounded-xl border border-[var(--line)] px-4 py-3"
            onChange={event => setDraft(current => ({ ...current, title: event.target.value }))}
            placeholder="Titel"
            required
            value={draft.title}
          />
          <textarea
            className="min-h-28 rounded-xl border border-[var(--line)] px-4 py-3"
            onChange={event =>
              setDraft(current => ({ ...current, description: event.target.value }))
            }
            placeholder="Kurzbeschreibung"
            value={draft.description}
          />
          <label className="flex items-center gap-2 text-sm">
            Bestätigung
            <select
              className="rounded-lg border border-[var(--line)] px-3 py-2"
              onChange={event =>
                setDraft(current => ({
                  ...current,
                  confirmationMode: event.target.value as "doi" | "otp",
                }))
              }
              value={draft.confirmationMode}
            >
              <option value="doi">DOI-Link</option>
              <option value="otp">OTP-Code</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              checked={draft.isPublished}
              onChange={event =>
                setDraft(current => ({ ...current, isPublished: event.target.checked }))
              }
              type="checkbox"
            />
            Veröffentlicht
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white"
              disabled={upsertMutation.isPending}
              type="submit"
            >
              Speichern
            </button>
            {editingId ? (
              <button
                className="rounded-xl border border-[var(--line)] px-5 py-3 text-sm"
                onClick={() => {
                  setEditingId(null);
                  setDraft(emptyDraft);
                }}
                type="button"
              >
                Abbrechen
              </button>
            ) : null}
          </div>
          {upsertMutation.error ? (
            <p className="text-sm text-[var(--danger)]">{upsertMutation.error.message}</p>
          ) : null}
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Deine Freebies</h2>
        <div className="mt-4 grid gap-4">
          {(offersQuery.data ?? []).map(offer => (
            <article
              key={offer.id}
              className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">{offer.title}</h3>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    /o/{offer.slug} · {offer.confirmationMode.toUpperCase()} ·{" "}
                    {offer.isPublished ? "live" : "entwurf"}
                    {offer.mediaAssetId ? " · Datei ok" : " · keine Datei"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
                    href={`/o/${offer.slug}`}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Vorschau
                  </a>
                  <button
                    className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
                    onClick={() => {
                      setEditingId(offer.id);
                      setDraft({
                        title: offer.title,
                        description: offer.description,
                        confirmationMode: offer.confirmationMode,
                        isPublished: offer.isPublished,
                      });
                    }}
                    type="button"
                  >
                    Bearbeiten
                  </button>
                  <button
                    className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
                    onClick={() => setSelectedOfferId(offer.id)}
                    type="button"
                  >
                    Leads
                  </button>
                </div>
              </div>
              <label className="mt-4 inline-flex cursor-pointer items-center gap-2 text-sm text-[var(--muted)]">
                Datei hochladen (Bunny)
                <input
                  accept=".pdf,.zip,.png,.jpg,.jpeg,.webp,.mp4,.mov,application/pdf"
                  className="text-sm"
                  onChange={async event => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    const buffer = await file.arrayBuffer();
                    const dataBase64 = btoa(
                      Array.from(new Uint8Array(buffer), byte => String.fromCharCode(byte)).join(""),
                    );
                    await uploadMutation.mutateAsync({
                      offerId: offer.id,
                      filename: file.name,
                      contentType: file.type || "application/octet-stream",
                      dataBase64,
                    });
                    event.target.value = "";
                  }}
                  type="file"
                />
              </label>
              {uploadMutation.error ? (
                <p className="mt-2 text-sm text-[var(--danger)]">{uploadMutation.error.message}</p>
              ) : null}
            </article>
          ))}
          {!offersQuery.data?.length ? (
            <p className="text-sm text-[var(--muted)]">Noch keine Freebies angelegt.</p>
          ) : null}
        </div>
      </section>

      {selectedOfferId ? (
        <section className="mt-8 rounded-2xl border border-[var(--line)] bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Leads</h2>
            <button
              className="text-sm text-[var(--muted)]"
              onClick={() => setSelectedOfferId(null)}
              type="button"
            >
              Schließen
            </button>
          </div>
          <ul className="mt-4 space-y-2 text-sm">
            {(leadsQuery.data ?? []).map(lead => (
              <li key={lead.id} className="flex flex-wrap justify-between gap-2 border-b border-[var(--line)] py-2">
                <span>{lead.email}</span>
                <span className="text-[var(--muted)]">
                  {lead.status} · {new Date(lead.createdAt).toLocaleString("de-DE")}
                </span>
              </li>
            ))}
            {!leadsQuery.data?.length ? (
              <li className="text-[var(--muted)]">Noch keine Leads.</li>
            ) : null}
          </ul>
        </section>
      ) : null}
    </AdminShell>
  );
}

function AdminShell({ children }: { children: ReactNode }) {
  return <main className="mx-auto min-h-screen max-w-5xl px-6 py-12">{children}</main>;
}
