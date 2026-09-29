import { useState, type FormEvent } from "react";
import { ArrowLeft, Building2, CalendarDays, Download, FileText, Loader2, Mail, NotebookPen, Phone, ThumbsDown, ThumbsUp, UserRound } from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import type { ApplicationStatus, LeadQuality } from "@shared/funnel";
import { LEAD_QUALITY_LABELS } from "@shared/leadValue";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, statusLabels } from "./Applications";
import { DeleteApplicationButton, formatPurgeDate, RestoreApplicationButton } from "@/components/admin/ApplicationTrashControls";
import { formatBerlinDateTime } from "@shared/berlinTime";

function qualityLabel(quality?: LeadQuality) {
  return quality ? LEAD_QUALITY_LABELS[quality] : "Noch nicht bewertet";
}

function metaQualityHint(status?: string, reason?: string) {
  if (status === "sent" && reason === "already_sent") return "Diese Bewertung wurde bereits von Meta bestätigt.";
  if (status === "sent") return "Meta hat die Qualitätsstufe bestätigt. Neue Ad Sets können mit dem Performance-Ziel „qualifizierte Leads“ darauf optimieren.";
  if (status === "skipped" && reason === "browser_only") {
    return "Bewertung gespeichert. Prüfe die CAPI-Verbindung unter Tracking und sende dieselbe Bewertung danach erneut.";
  }
  if (status === "skipped" && reason === "tracking_disabled") {
    return "Bewertung gespeichert. Schalte Meta-Tracking im Funnel ein und sende dieselbe Bewertung danach erneut.";
  }
  if (status === "failed") return "Bewertung gespeichert, aber von Meta nicht bestätigt. Prüfe CAPI und klicke dieselbe Bewertung zum erneuten Senden an.";
  if (status === "skipped") return "Bewertung gespeichert, aber noch nicht an Meta gemeldet.";
  return null;
}

export default function ApplicationDetail() {
  const [isScoped, scopedParams] = useRoute("/admin/funnels/:funnelId/applications/:id");
  const [, globalParams] = useRoute("/admin/applications/:id");
  const [, setLocation] = useLocation();
  const applicationId = scopedParams?.id ?? globalParams?.id;
  const scopedFunnelId = isScoped ? scopedParams?.funnelId : undefined;
  const utils = trpc.useUtils();
  const query = trpc.funnel.application.useQuery({ id: applicationId ?? "00000000-0000-4000-8000-000000000000" }, { enabled: Boolean(applicationId) });
  const funnelsQuery = trpc.funnel.funnels.useQuery();
  const update = trpc.funnel.updateStatus.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.funnel.application.invalidate(), utils.funnel.applications.invalidate(), utils.funnel.funnels.invalidate()]);
      toast.success("Status aktualisiert");
    },
    onError: error => toast.error(error.message),
  });
  const rate = trpc.funnel.rateLeadQuality.useMutation({
    onSuccess: async result => {
      await Promise.all([utils.funnel.application.invalidate(), utils.funnel.applications.invalidate()]);
      toast.success(result.leadQuality === "good" ? "Als guter Lead bewertet" : "Als schlechter Lead bewertet");
      const hint = metaQualityHint(result.metaQuality, result.metaQualityReason);
      if (hint && result.metaQuality !== "sent") toast.message(hint);
    },
    onError: error => toast.error(error.message),
  });
  const application = query.data;
  const funnel = funnelsQuery.data?.find(item => item.slug === application?.funnelSlug);
  const backPath = scopedFunnelId ? `/admin/funnels/${scopedFunnelId}/applications` : "/admin/applications";

  if (query.isLoading) {
    return (
      <div className="grid min-h-[60vh] place-items-center" role="status" aria-live="polite">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="animate-spin text-[#0165c3]" aria-hidden="true" />
          Eintrag wird geladen …
        </span>
      </div>
    );
  }
  if (!application || query.error) {
    return (
      <div className="p-8">
        <Button variant="ghost" onClick={() => setLocation(backPath)}>
          <ArrowLeft className="size-4" />
          Zur Eingangsübersicht
        </Button>
        <p className="mt-8 text-destructive" role="alert">{query.error?.message ?? "Eintrag nicht gefunden."}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-2 sm:p-4">
      <Button variant="ghost" className="-ml-3" onClick={() => setLocation(backPath)}>
        <ArrowLeft className="size-4" />
        Zur Eingangsübersicht
      </Button>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <StatusBadge status={application.status} />
            <span className="text-xs text-muted-foreground">ID {application.id.slice(0, 8)}</span>
            {funnel && (
              <button type="button" className="text-xs font-semibold text-[#0165c3] hover:underline" onClick={() => setLocation(`/admin/funnels/${funnel.id}/applications`)}>
                {funnel.title}
              </button>
            )}
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{application.contact.name || "Eintrag ohne Namen"}</h1>
          <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays className="size-4" aria-hidden="true" />
            Eingegangen am {formatBerlinDateTime(application.createdAt)}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
        <Select
          value={application.status}
          onValueChange={status => update.mutate({ id: application.id, status: status as ApplicationStatus })}
          disabled={update.isPending}
        >
          <SelectTrigger className="w-full bg-white sm:w-48" aria-label="Status ändern" aria-busy={update.isPending}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(statusLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!application.deletedAt && (
          <DeleteApplicationButton
            variant="button"
            applicationId={application.id}
            personLabel={application.contact.name || "unbekannt"}
            onDeleted={() => setLocation(backPath)}
          />
        )}
        </div>
      </header>

      {application.deletedAt && application.purgeAt && (
        <section className="flex flex-col justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 sm:flex-row sm:items-center" role="status">
          <p>
            Dieser Eintrag liegt im Papierkorb und wird am {formatPurgeDate(application.purgeAt)} endgültig gelöscht.
          </p>
          <RestoreApplicationButton applicationId={application.id} />
        </section>
      )}

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-bold">Lead-Qualität für Meta</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Gute Leads gehen als Qualitätsstufe <code>QualifiedLead</code> mit Wert zurück,
              schlechte als <code>DisqualifiedLead</code>. Meta kann diese Rückmeldungen bei
              neuen Ad Sets mit dem Performance-Ziel „qualifizierte Leads“ verwenden. Laufende
              Lead-Volumen-Kampagnen werden nicht automatisch umgestellt.
            </p>
          </div>
          <div className="text-sm">
            <p className="font-semibold">{qualityLabel(application.leadQuality)}</p>
            {application.leadValue !== undefined && (
              <p className="text-xs text-muted-foreground">Antwort-Wert {application.leadValue.toLocaleString("de-DE")} €</p>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            className={application.leadQuality === "good" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-[#0165c3] hover:bg-[#0154a3]"}
            disabled={rate.isPending}
            onClick={() => rate.mutate({ id: application.id, quality: "good" })}
          >
            {rate.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ThumbsUp className="size-4" />}
            {application.leadQuality === "good" && application.leadQualityMetaStatus !== "sent" ? "Gut erneut senden" : "Gut"}
          </Button>
          <Button
            variant={application.leadQuality === "bad" ? "destructive" : "outline"}
            disabled={rate.isPending}
            onClick={() => rate.mutate({ id: application.id, quality: "bad" })}
          >
            <ThumbsDown className="size-4" />
            {application.leadQuality === "bad" && application.leadQualityMetaStatus !== "sent" ? "Schlecht erneut senden" : "Schlecht"}
          </Button>
        </div>
        {application.leadQualityAt && (
          <p className="mt-3 text-xs text-muted-foreground">
            Zuletzt bewertet am {formatBerlinDateTime(application.leadQualityAt)}
            {application.leadQualityMetaStatus ? ` · Meta: ${application.leadQualityMetaStatus}` : ""}
          </p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[.8fr_1.2fr]">
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-bold">Kontaktdaten</h2>
          <div className="mt-5 grid gap-4">
            <Contact icon={UserRound} label="Name" value={application.contact.name} />
            <Contact icon={Building2} label="Firma" value={application.contact.company} />
            <Contact icon={Mail} label="E-Mail" value={application.contact.email} href={application.contact.email ? `mailto:${application.contact.email}` : undefined} />
            <Contact icon={Phone} label="Telefon" value={application.contact.phone} href={application.contact.phone ? `tel:${application.contact.phone}` : undefined} />
          </div>
          {application.contact.message && (
            <div className="mt-6 border-t pt-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Freitext</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{application.contact.message}</p>
            </div>
          )}
        </section>
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-bold">Antworten</h2>
          <div className="mt-5 grid gap-3">
            {application.displayAnswers.map((answer, index) => (
              <div key={`${answer.label}-${index}`} className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm text-muted-foreground">{answer.label}</p>
                <p className="mt-2 font-semibold">{answer.values.join(", ")}</p>
              </div>
            ))}
          </div>
          {application.displayAnswers.length === 0 && <p className="mt-5 text-sm text-muted-foreground">Keine Antworten gespeichert.</p>}
        </section>
      </div>

      <ApplicationNotes applicationId={application.id} />

      {application.resume && (
        <section className="flex flex-col justify-between gap-4 rounded-2xl border bg-white p-5 shadow-sm sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-[#0165c3]"><FileText /></span>
            <span className="min-w-0">
              <strong className="block truncate">{application.resume.fileName}</strong>
              <small className="text-muted-foreground">{(application.resume.size / 1024 / 1024).toFixed(2)} MB</small>
            </span>
          </div>
          <Button variant="outline" asChild>
            <a href={application.resume.url} target="_blank" rel="noreferrer">
              <Download className="size-4" />
              Lebenslauf öffnen
            </a>
          </Button>
        </section>
      )}

      <section className="rounded-2xl border bg-white p-5 text-xs text-muted-foreground shadow-sm">
        <h2 className="font-bold text-foreground">Technische Angaben</h2>
        <dl className="mt-4 grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="font-semibold">Funnel</dt>
            <dd>{funnel?.title ?? application.funnelSlug} · /f/{application.funnelSlug}</dd>
          </div>
          <div>
            <dt className="font-semibold">Einwilligung</dt>
            <dd>{formatBerlinDateTime(application.consentAt)}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="font-semibold">Quelle</dt>
            <dd className="break-all">{application.sourceUrl || "–"}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

function Contact({ icon: Icon, label, value, href }: { icon: typeof UserRound; label: string; value?: string; href?: string }) {
  const content = (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500"><Icon className="size-4" /></span>
      <span className="min-w-0">
        <small className="block text-xs text-muted-foreground">{label}</small>
        <strong className="block truncate text-sm">{value || "–"}</strong>
      </span>
    </>
  );
  return href ? <a className="flex items-center gap-3 rounded-xl transition hover:text-[#0165c3]" href={href}>{content}</a> : <div className="flex items-center gap-3">{content}</div>;
}

const NOTE_MAX_LENGTH = 5000;

const loginMethodLabels: Record<string, string> = {
  member: "Zugang",
  "adbot-sso": "Konto-Inhaber",
  password: "Adbot-Team",
};

function ApplicationNotes({ applicationId }: { applicationId: string }) {
  const [draft, setDraft] = useState("");
  const utils = trpc.useUtils();
  const notesQuery = trpc.funnel.applicationNotes.useQuery({ id: applicationId });
  const add = trpc.funnel.addApplicationNote.useMutation({
    onSuccess: async () => {
      setDraft("");
      await utils.funnel.applicationNotes.invalidate({ id: applicationId });
      toast.success("Notiz gespeichert");
    },
    onError: error => toast.error(error.message),
  });
  const notes = notesQuery.data ?? [];
  const canSubmit = draft.trim().length > 0 && !add.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    add.mutate({ id: applicationId, body: draft });
  }

  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm" aria-labelledby="application-notes-heading">
      <div className="flex items-center gap-2">
        <NotebookPen className="size-4 text-[#0165c3]" aria-hidden="true" />
        <h2 id="application-notes-heading" className="font-bold">Aktennotizen</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Jede Notiz wird mit Name und Zeitpunkt gespeichert und kann danach nicht mehr geändert werden.
      </p>

      {notesQuery.isLoading ? (
        <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Notizen werden geladen …
        </p>
      ) : notesQuery.error ? (
        <p className="mt-5 text-sm text-destructive" role="alert">{notesQuery.error.message}</p>
      ) : notes.length === 0 ? (
        <p className="mt-5 text-sm text-muted-foreground">Noch keine Notizen.</p>
      ) : (
        <ol className="mt-5 grid gap-3">
          {notes.map(note => (
            <li key={note.id} className="rounded-xl bg-slate-50 p-4">
              <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                <strong className="text-sm text-foreground">{note.authorName || note.authorEmail || "Unbekannt"}</strong>
                {note.authorName && note.authorEmail && note.authorName !== note.authorEmail && <span>{note.authorEmail}</span>}
                {loginMethodLabels[note.authorLoginMethod] && <span>· {loginMethodLabels[note.authorLoginMethod]}</span>}
                <time dateTime={note.createdAt} className="ml-auto">{new Date(note.createdAt).toLocaleString("de-DE")}</time>
              </p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{note.body}</p>
            </li>
          ))}
        </ol>
      )}

      <form className="mt-5 grid gap-2 border-t pt-5" onSubmit={submit}>
        <label htmlFor="application-note-input" className="text-sm font-semibold">Neue Notiz</label>
        <Textarea
          id="application-note-input"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit(event);
          }}
          maxLength={NOTE_MAX_LENGTH}
          rows={3}
          placeholder="z. B. Telefonat geführt, Rückruf am Freitag vereinbart"
          disabled={add.isPending}
        />
        <div className="flex items-center justify-between gap-3">
          <small className="text-xs text-muted-foreground">{draft.length.toLocaleString("de-DE")} / {NOTE_MAX_LENGTH.toLocaleString("de-DE")}</small>
          <Button type="submit" className="bg-[#0165c3] hover:bg-[#0154a3]" disabled={!canSubmit}>
            {add.isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Notiz speichern
          </Button>
        </div>
      </form>
    </section>
  );
}
