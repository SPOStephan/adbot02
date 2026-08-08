import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, FileDown, Inbox, Loader2, Search, SlidersHorizontal } from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import type { ApplicationRecord, ApplicationStatus } from "@shared/funnel";
import { filterApplications, getApplicationTotals, type ApplicationFilter } from "@shared/applicationFilters";
import { trpc } from "@/lib/trpc";
import { downloadBase64File } from "@/lib/download";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const statusLabels: Record<ApplicationStatus, string> = {
  new: "Neu",
  reviewing: "In Prüfung",
  contacted: "Kontaktiert",
  rejected: "Abgelehnt",
  hired: "Eingestellt",
};

const statusClasses: Record<ApplicationStatus, string> = {
  new: "bg-blue-50 text-blue-700 ring-blue-600/10",
  reviewing: "bg-amber-50 text-amber-800 ring-amber-600/15",
  contacted: "bg-violet-50 text-violet-700 ring-violet-600/10",
  rejected: "bg-slate-100 text-slate-600 ring-slate-500/10",
  hired: "bg-emerald-50 text-emerald-700 ring-emerald-600/10",
};

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${statusClasses[status]}`}>{statusLabels[status]}</span>;
}

export default function Applications() {
  const [, setLocation] = useLocation();
  const [isScoped, scopedParams] = useRoute("/admin/funnels/:id/applications");
  const routedFunnelId = isScoped ? scopedParams?.id : undefined;
  const funnelsQuery = trpc.funnel.funnels.useQuery();
  const [selectedFunnel, setSelectedFunnel] = useState(routedFunnelId ?? "all");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ApplicationFilter>("all");

  useEffect(() => { if (routedFunnelId) setSelectedFunnel(routedFunnelId); }, [routedFunnelId]);

  const funnelId = routedFunnelId ?? (selectedFunnel === "all" ? undefined : selectedFunnel);
  const queryInput = useMemo(() => funnelId ? { funnelId } : undefined, [funnelId]);
  const query = trpc.funnel.applications.useQuery(queryInput);
  const csv = trpc.funnel.exportCsv.useMutation({ onSuccess: download => downloadBase64File(download.fileName, download.mimeType, download.dataBase64), onError: error => toast.error(error.message) });
  const pdf = trpc.funnel.exportPdf.useMutation({ onSuccess: download => downloadBase64File(download.fileName, download.mimeType, download.dataBase64), onError: error => toast.error(error.message) });

  const selectedSummary = funnelsQuery.data?.find(funnel => funnel.id === funnelId);
  const funnelTitles = useMemo(() => new Map((funnelsQuery.data ?? []).map(funnel => [funnel.slug, funnel.title])), [funnelsQuery.data]);
  const applications = useMemo(() => filterApplications(query.data ?? [], { status, search, funnelTitles }), [funnelTitles, query.data, search, status]);
  const totals = useMemo(() => getApplicationTotals(query.data ?? []), [query.data]);
  const openApplication = (application: ApplicationRecord) => setLocation(routedFunnelId ? `/admin/funnels/${routedFunnelId}/applications/${application.id}` : `/admin/applications/${application.id}`);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-2 sm:p-4">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>{routedFunnelId && <Button variant="ghost" className="-ml-3 mb-2" onClick={() => setLocation("/admin")}><ArrowLeft className="size-4" />Funnel-Bibliothek</Button>}<p className="text-xs font-bold uppercase tracking-[.15em] text-[#0165c3]">Recruiting Inbox</p><h1 className="mt-1 text-3xl font-bold tracking-tight">{selectedSummary ? `Bewerbungen · ${selectedSummary.title}` : "Bewerbungen"}</h1><p className="mt-2 text-sm text-muted-foreground">{selectedSummary ? `Alle Einsendungen über /f/${selectedSummary.slug}.` : "Alle eingegangenen Bewerbungen zentral prüfen, nach Funnel filtern und exportieren."}</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={csv.isPending || query.isLoading} aria-busy={csv.isPending} onClick={() => csv.mutate(queryInput)}>{csv.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}CSV exportieren</Button><Button variant="outline" disabled={pdf.isPending || query.isLoading} aria-busy={pdf.isPending} onClick={() => pdf.mutate(queryInput)}>{pdf.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <FileDown className="size-4" aria-hidden="true" />}PDF exportieren</Button></div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Gesamt" value={totals.all} active={status === "all"} onClick={() => setStatus("all")} />
        <Stat label="Neu" value={totals.new} active={status === "new"} onClick={() => setStatus("new")} />
        <Stat label="In Bearbeitung" value={totals.active} active={status === "active"} onClick={() => setStatus("active")} />
      </div>

      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row">
          <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input className="pl-9" aria-label="Bewerbungen durchsuchen" placeholder="Name, Firma, E-Mail, Funnel oder ID suchen …" value={search} onChange={event => setSearch(event.target.value)} /></div>
          {!routedFunnelId && <Select value={selectedFunnel} onValueChange={setSelectedFunnel}><SelectTrigger className="w-full lg:w-60" aria-label="Nach Funnel filtern"><SelectValue placeholder="Alle Funnel" /></SelectTrigger><SelectContent><SelectItem value="all">Alle Funnel</SelectItem>{funnelsQuery.data?.map(funnel => <SelectItem key={funnel.id} value={funnel.id}>{funnel.title}</SelectItem>)}</SelectContent></Select>}
          <Select value={status} onValueChange={value => setStatus(value as ApplicationFilter)}><SelectTrigger className="w-full lg:w-44" aria-label="Nach Bewerbungsstatus filtern"><SlidersHorizontal className="size-4" aria-hidden="true" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alle Status</SelectItem><SelectItem value="active">In Bearbeitung</SelectItem>{Object.entries(statusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
        </div>

        {query.isLoading ? <div className="grid min-h-72 place-items-center" role="status" aria-live="polite"><span className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-5 animate-spin text-[#0165c3]" aria-hidden="true" />Bewerbungen werden geladen …</span></div> : query.error ? <div className="p-8 text-center text-destructive" role="alert">{query.error.message}</div> : applications.length === 0 ? <EmptyState hasAny={(query.data?.length ?? 0) > 0} /> : <>
          <div className="hidden md:block"><Table><TableHeader><TableRow><TableHead>Bewerber</TableHead>{!routedFunnelId && <TableHead>Funnel</TableHead>}<TableHead>Kontakt</TableHead><TableHead>Eingang</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Antworten</TableHead></TableRow></TableHeader><TableBody>{applications.map(application => <ApplicationRow key={application.id} application={application} funnelTitle={funnelTitles.get(application.funnelSlug)} showFunnel={!routedFunnelId} onOpen={() => openApplication(application)} />)}</TableBody></Table></div>
          <div className="divide-y md:hidden">{applications.map(application => <button key={application.id} className="block w-full p-4 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0165c3]" onClick={() => openApplication(application)}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><strong className="block truncate">{application.contact.name || "Ohne Namen"}</strong><span className="mt-1 block truncate text-xs text-muted-foreground">{application.contact.email || application.contact.phone || "Keine Kontaktdaten"}</span>{!routedFunnelId && <span className="mt-1 block truncate text-xs font-semibold text-[#0165c3]">{funnelTitles.get(application.funnelSlug) ?? application.funnelSlug}</span>}</div><StatusBadge status={application.status} /></div><div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>{new Date(application.createdAt).toLocaleDateString("de-DE")}</span><span>{Object.keys(application.answers).length} Antworten</span></div></button>)}</div>
        </>}
      </section>
    </div>
  );
}

function Stat({ label, value, active, onClick }: { label: string; value: number; active: boolean; onClick: () => void }) {
  return <button type="button" aria-pressed={active} className={`rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0165c3] ${active ? "border-[#0165c3]/30 bg-[#0165c3]/5 shadow-sm" : "bg-white hover:border-slate-300"}`} onClick={onClick}><span className="text-xs font-semibold text-muted-foreground">{label}</span><strong className="mt-2 block text-2xl tracking-tight">{value}</strong></button>;
}

function ApplicationRow({ application, funnelTitle, showFunnel, onOpen }: { application: ApplicationRecord; funnelTitle?: string; showFunnel: boolean; onOpen: () => void }) {
  return <TableRow className="cursor-pointer" onClick={onOpen}><TableCell><button type="button" className="rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0165c3]" aria-label={`Bewerbung von ${application.contact.name || "unbekannt"} öffnen`} onClick={event => { event.stopPropagation(); onOpen(); }}><strong className="block">{application.contact.name || "Ohne Namen"}</strong><span className="text-xs text-muted-foreground">{application.contact.company || "–"}</span></button></TableCell>{showFunnel && <TableCell><span className="block max-w-44 truncate text-sm font-semibold">{funnelTitle ?? application.funnelSlug}</span><span className="font-mono text-[10px] text-muted-foreground">/f/{application.funnelSlug}</span></TableCell>}<TableCell><span className="block text-sm">{application.contact.email || "–"}</span><span className="text-xs text-muted-foreground">{application.contact.phone || ""}</span></TableCell><TableCell><span className="block text-sm">{new Date(application.createdAt).toLocaleDateString("de-DE")}</span><span className="text-xs text-muted-foreground">{new Date(application.createdAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</span></TableCell><TableCell><StatusBadge status={application.status} /></TableCell><TableCell className="text-right font-semibold">{Object.keys(application.answers).length}</TableCell></TableRow>;
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  return <div className="grid min-h-72 place-items-center p-8 text-center" role="status"><div><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-blue-50 text-[#0165c3]" aria-hidden="true"><Inbox /></span><h2 className="mt-4 font-bold">{hasAny ? "Keine Treffer" : "Noch keine Bewerbungen"}</h2><p className="mt-2 max-w-sm text-sm text-muted-foreground">{hasAny ? "Passe Suche oder Filter an." : "Neue Einsendungen erscheinen automatisch in dieser Übersicht."}</p></div></div>;
}
