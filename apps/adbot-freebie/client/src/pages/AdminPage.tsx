import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import type { FreebieOffer } from "@shared/types";
import {
  ExternalLink,
  FileUp,
  Gift,
  Loader2,
  Plus,
  Sparkles,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";

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
  const utils = trpc.useUtils();
  const offersQuery = trpc.freebies.list.useQuery();
  const upsertMutation = trpc.freebies.upsert.useMutation({
    onSuccess: async () => {
      await utils.freebies.list.invalidate();
      setDraft(emptyDraft);
      setEditingId(null);
      setCreateOpen(false);
    },
  });
  const uploadMutation = trpc.freebies.uploadAsset.useMutation({
    onSuccess: async () => utils.freebies.list.invalidate(),
  });

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const leadsQuery = trpc.freebies.leads.useQuery(
    { offerId: selectedOfferId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(selectedOfferId) },
  );

  const totals = useMemo(() => {
    const offers = offersQuery.data ?? [];
    return {
      total: offers.length,
      published: offers.filter(offer => offer.isPublished).length,
      withFile: offers.filter(offer => offer.mediaAssetId).length,
    };
  }, [offersQuery.data]);

  const openCreate = () => {
    setEditingId(null);
    setDraft(emptyDraft);
    setCreateOpen(true);
  };

  const openEdit = (offer: FreebieOffer) => {
    setEditingId(offer.id);
    setDraft({
      title: offer.title,
      description: offer.description,
      confirmationMode: offer.confirmationMode,
      isPublished: offer.isPublished,
    });
    setCreateOpen(true);
  };

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-7xl space-y-7 p-2 sm:p-4">
        <header className="relative overflow-hidden rounded-[28px] bg-[#10253f] px-5 py-7 text-white shadow-xl shadow-slate-200 sm:px-8 sm:py-9">
          <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-[#0165c3]/45 blur-2xl" />
          <div className="pointer-events-none absolute bottom-0 right-1/3 h-28 w-48 rotate-12 rounded-full bg-cyan-300/10 blur-2xl" />
          <div className="relative flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
            <div className="max-w-2xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1.5 text-xs font-semibold uppercase tracking-[.16em] text-blue-100">
                <Gift className="size-3.5" aria-hidden="true" /> Freebie-Bibliothek
              </div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Lead-Magnete zentral steuern
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">
                Lade Dateien auf Bunny hoch, wähle DOI oder OTP und liefere Freebies
                nach E-Mail-Bestätigung aus.
              </p>
            </div>
            <button
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-white px-5 text-sm font-semibold text-[#10253f] shadow-lg transition hover:bg-blue-50"
              onClick={openCreate}
              type="button"
            >
              <Plus className="size-4" aria-hidden="true" /> Neues Freebie erstellen
            </button>
          </div>
        </header>

        <section
          aria-label="Freebie-Kennzahlen"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          <Metric
            detail={`${totals.published} veröffentlicht`}
            icon={Gift}
            label="Freebies gesamt"
            value={totals.total}
          />
          <Metric
            detail="öffentlich erreichbar"
            icon={Sparkles}
            label="Aktive Angebote"
            value={totals.published}
          />
          <Metric
            accent
            detail="Bunny / Media Library"
            icon={FileUp}
            label="Mit Datei"
            value={totals.withFile}
          />
          <button
            className="group flex min-h-28 items-center gap-4 rounded-2xl border border-dashed border-[#0165c3]/35 bg-blue-50/50 p-5 text-left transition hover:border-[#0165c3] hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0165c3]"
            onClick={openCreate}
            type="button"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#0165c3] text-white shadow-md shadow-blue-200">
              <Plus className="size-5" />
            </span>
            <span>
              <strong className="block text-sm text-[#10253f]">Neues Freebie</strong>
              <small className="mt-1 block leading-5 text-muted-foreground">
                Mit DOI- oder OTP-Bestätigung starten
              </small>
            </span>
          </button>
        </section>

        <section className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b p-4">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-[#10253f]">
                Deine Freebies
              </h2>
              <p className="text-sm text-muted-foreground">
                Verwalte Angebote, Uploads und Lead-Status.
              </p>
            </div>
          </div>

          {offersQuery.isLoading ? (
            <div className="grid min-h-80 place-items-center" role="status">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-5 animate-spin text-[#0165c3]" />
                Freebies werden geladen …
              </span>
            </div>
          ) : offersQuery.error ? (
            <div className="p-10 text-center text-destructive" role="alert">
              {offersQuery.error.message}
            </div>
          ) : !(offersQuery.data?.length ?? 0) ? (
            <div className="grid min-h-80 place-items-center p-8 text-center">
              <div>
                <p className="text-sm text-muted-foreground">
                  Noch keine Freebies angelegt.
                </p>
                <button
                  className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-[#0165c3] px-4 text-sm font-medium text-white hover:bg-[#0154a3]"
                  onClick={openCreate}
                  type="button"
                >
                  <Plus className="size-4" /> Erstes Freebie anlegen
                </button>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-2 2xl:grid-cols-3">
              {(offersQuery.data ?? []).map(offer => (
                <OfferCard
                  key={offer.id}
                  offer={offer}
                  uploadPending={
                    uploadMutation.isPending &&
                    uploadMutation.variables?.offerId === offer.id
                  }
                  uploadError={
                    uploadMutation.isPending &&
                    uploadMutation.variables?.offerId === offer.id
                      ? null
                      : uploadMutation.error &&
                          uploadMutation.variables?.offerId === offer.id
                        ? uploadMutation.error.message
                        : null
                  }
                  onEdit={() => openEdit(offer)}
                  onLeads={() => setSelectedOfferId(offer.id)}
                  onUpload={async file => {
                    const buffer = await file.arrayBuffer();
                    const dataBase64 = btoa(
                      Array.from(new Uint8Array(buffer), byte =>
                        String.fromCharCode(byte),
                      ).join(""),
                    );
                    await uploadMutation.mutateAsync({
                      offerId: offer.id,
                      filename: file.name,
                      contentType: file.type || "application/octet-stream",
                      dataBase64,
                    });
                  }}
                />
              ))}
            </div>
          )}
        </section>

        {selectedOfferId ? (
          <section className="overflow-hidden rounded-3xl border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-[#0165c3]">
                  <Users className="size-5" />
                </span>
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-[#10253f]">
                    Leads
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Erfasste E-Mails für dieses Freebie
                  </p>
                </div>
              </div>
              <button
                className="text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setSelectedOfferId(null)}
                type="button"
              >
                Schließen
              </button>
            </div>
            <ul className="mt-4 divide-y">
              {(leadsQuery.data ?? []).map(lead => (
                <li
                  key={lead.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                >
                  <span className="font-medium text-[#10253f]">{lead.email}</span>
                  <span className="text-muted-foreground">
                    <StatusPill status={lead.status} /> ·{" "}
                    {new Date(lead.createdAt).toLocaleString("de-DE")}
                  </span>
                </li>
              ))}
              {!leadsQuery.data?.length ? (
                <li className="py-6 text-sm text-muted-foreground">Noch keine Leads.</li>
              ) : null}
            </ul>
          </section>
        ) : null}

        {createOpen ? (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
            <form
              className="w-full max-w-lg rounded-2xl border bg-white p-6 shadow-xl"
              onSubmit={async event => {
                event.preventDefault();
                await upsertMutation.mutateAsync({
                  id: editingId ?? undefined,
                  ...draft,
                });
              }}
            >
              <h2 className="text-xl font-bold tracking-tight text-[#10253f]">
                {editingId ? "Freebie bearbeiten" : "Neues Freebie"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Titel, Beschreibung und Bestätigungsmodus festlegen.
              </p>
              <div className="mt-5 grid gap-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium" htmlFor="freebie-title">
                    Titel
                  </label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    id="freebie-title"
                    onChange={event =>
                      setDraft(current => ({ ...current, title: event.target.value }))
                    }
                    required
                    value={draft.title}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium" htmlFor="freebie-desc">
                    Beschreibung
                  </label>
                  <textarea
                    className="min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    id="freebie-desc"
                    onChange={event =>
                      setDraft(current => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    value={draft.description}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium" htmlFor="freebie-mode">
                    Bestätigung
                  </label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    id="freebie-mode"
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
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    checked={draft.isPublished}
                    onChange={event =>
                      setDraft(current => ({
                        ...current,
                        isPublished: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  Veröffentlicht
                </label>
                {upsertMutation.error ? (
                  <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {upsertMutation.error.message}
                  </p>
                ) : null}
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  className="inline-flex h-10 items-center rounded-md border px-4 text-sm"
                  disabled={upsertMutation.isPending}
                  onClick={() => {
                    setCreateOpen(false);
                    setEditingId(null);
                    setDraft(emptyDraft);
                  }}
                  type="button"
                >
                  Abbrechen
                </button>
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-[#0165c3] px-4 text-sm font-medium text-white hover:bg-[#0154a3] disabled:opacity-60"
                  disabled={upsertMutation.isPending || !draft.title.trim()}
                  type="submit"
                >
                  {upsertMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  Speichern
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
  accent = false,
}: {
  icon: typeof Gift;
  label: string;
  value: number;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex min-h-28 items-center gap-4 rounded-2xl border p-5 shadow-sm ${
        accent ? "border-blue-200 bg-blue-50/70" : "bg-white"
      }`}
    >
      <span
        className={`grid size-11 shrink-0 place-items-center rounded-2xl ${
          accent ? "bg-[#0165c3] text-white" : "bg-slate-100 text-slate-600"
        }`}
      >
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div>
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <strong className="mt-1 block text-2xl tracking-tight">{value}</strong>
        <small className="text-xs text-muted-foreground">{detail}</small>
      </div>
    </div>
  );
}

function OfferCard({
  offer,
  onEdit,
  onLeads,
  onUpload,
  uploadPending,
  uploadError,
}: {
  offer: FreebieOffer;
  onEdit: () => void;
  onLeads: () => void;
  onUpload: (file: File) => Promise<void>;
  uploadPending: boolean;
  uploadError: string | null;
}) {
  const statusClass = offer.isPublished
    ? "bg-emerald-50 text-emerald-700 ring-emerald-600/15"
    : "bg-slate-100 text-slate-700 ring-slate-500/15";

  return (
    <article className="group relative overflow-hidden rounded-2xl border bg-white p-5 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#0165c3] via-cyan-400 to-transparent opacity-0 transition group-hover:opacity-100" />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${statusClass}`}
          >
            {offer.isPublished ? "Veröffentlicht" : "Entwurf"}
          </span>
          <h2 className="mt-3 truncate text-lg font-bold tracking-tight text-[#10253f]">
            {offer.title}
          </h2>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            /o/{offer.slug}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {offer.confirmationMode.toUpperCase()}
            {offer.mediaAssetId ? " · Datei ok" : " · keine Datei"}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-[#10253f] px-3 text-sm font-medium text-white hover:bg-[#183553]"
          onClick={onEdit}
          type="button"
        >
          Bearbeiten
        </button>
        <a
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-sm"
          href={`/o/${offer.slug}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          <ExternalLink className="size-4" />
          Vorschau
        </a>
        <button
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-sm"
          onClick={onLeads}
          type="button"
        >
          <Users className="size-4" />
          Leads
        </button>
      </div>

      <label className="mt-4 flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[#dce7f1] bg-slate-50 px-3 py-3 text-sm text-muted-foreground transition hover:border-[#0165c3] hover:bg-blue-50/50">
        {uploadPending ? (
          <Loader2 className="size-4 animate-spin text-[#0165c3]" />
        ) : (
          <FileUp className="size-4 text-[#0165c3]" />
        )}
        Datei hochladen (Bunny)
        <input
          accept=".pdf,.zip,.png,.jpg,.jpeg,.webp,.mp4,.mov,application/pdf"
          className="hidden"
          disabled={uploadPending}
          onChange={async event => {
            const file = event.target.files?.[0];
            if (!file) return;
            await onUpload(file);
            event.target.value = "";
          }}
          type="file"
        />
      </label>
      {uploadError ? (
        <p className="mt-2 text-sm text-destructive">{uploadError}</p>
      ) : null}
    </article>
  );
}

function StatusPill({ status }: { status: string }) {
  const className =
    status === "delivered"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-600/15"
      : status === "confirmed"
        ? "bg-blue-50 text-blue-700 ring-blue-600/15"
        : status === "expired"
          ? "bg-zinc-100 text-zinc-600 ring-zinc-500/15"
          : "bg-amber-50 text-amber-800 ring-amber-600/15";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${className}`}
    >
      {status}
    </span>
  );
}
