import { ArrowLeft, Building2, CalendarDays, Download, FileText, Loader2, Mail, Phone, UserRound } from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import type { ApplicationStatus } from "@shared/funnel";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, statusLabels } from "./Applications";

export default function ApplicationDetail() {
  const [isScoped, scopedParams] = useRoute("/admin/funnels/:funnelId/applications/:id");
  const [, globalParams] = useRoute("/admin/applications/:id");
  const [, setLocation] = useLocation();
  const applicationId = scopedParams?.id ?? globalParams?.id;
  const scopedFunnelId = isScoped ? scopedParams?.funnelId : undefined;
  const utils = trpc.useUtils();
  const query = trpc.funnel.application.useQuery({ id: applicationId ?? "00000000-0000-0000-0000-000000000000" }, { enabled: Boolean(applicationId) });
  const funnelsQuery = trpc.funnel.funnels.useQuery();
  const update = trpc.funnel.updateStatus.useMutation({ onSuccess: async () => { await Promise.all([utils.funnel.application.invalidate(), utils.funnel.applications.invalidate(), utils.funnel.funnels.invalidate()]); toast.success("Status aktualisiert"); }, onError: error => toast.error(error.message) });
  const application = query.data;
  const funnel = funnelsQuery.data?.find(item => item.slug === application?.funnelSlug);
  const backPath = scopedFunnelId ? `/admin/funnels/${scopedFunnelId}/applications` : "/admin/applications";

  if (query.isLoading) return <div className="grid min-h-[60vh] place-items-center" role="status" aria-live="polite"><span className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="animate-spin text-[#0165c3]" aria-hidden="true" />Bewerbung wird geladen …</span></div>;
  if (!application || query.error) return <div className="p-8"><Button variant="ghost" onClick={() => setLocation(backPath)}><ArrowLeft className="size-4" />Zur Bewerbungsübersicht</Button><p className="mt-8 text-destructive" role="alert">{query.error?.message ?? "Bewerbung nicht gefunden."}</p></div>;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-2 sm:p-4">
      <Button variant="ghost" className="-ml-3" onClick={() => setLocation(backPath)}><ArrowLeft className="size-4" />Zur Bewerbungsübersicht</Button>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="mb-3 flex flex-wrap items-center gap-3"><StatusBadge status={application.status} /><span className="text-xs text-muted-foreground">ID {application.id.slice(0, 8)}</span>{funnel && <button type="button" className="text-xs font-semibold text-[#0165c3] hover:underline" onClick={() => setLocation(`/admin/funnels/${funnel.id}/applications`)}>{funnel.title}</button>}</div><h1 className="text-3xl font-bold tracking-tight">{application.contact.name || "Bewerbung ohne Namen"}</h1><p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><CalendarDays className="size-4" aria-hidden="true" />Eingegangen am {new Date(application.createdAt).toLocaleString("de-DE")}</p></div><Select value={application.status} onValueChange={status => update.mutate({ id: application.id, status: status as ApplicationStatus })} disabled={update.isPending}><SelectTrigger className="w-full bg-white sm:w-48" aria-label="Bewerbungsstatus ändern" aria-busy={update.isPending}><SelectValue /></SelectTrigger><SelectContent>{Object.entries(statusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></header>

      <div className="grid gap-6 lg:grid-cols-[.8fr_1.2fr]">
        <section className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-bold">Kontaktdaten</h2><div className="mt-5 grid gap-4"><Contact icon={UserRound} label="Name" value={application.contact.name} /><Contact icon={Building2} label="Firma" value={application.contact.company} /><Contact icon={Mail} label="E-Mail" value={application.contact.email} href={application.contact.email ? `mailto:${application.contact.email}` : undefined} /><Contact icon={Phone} label="Telefon" value={application.contact.phone} href={application.contact.phone ? `tel:${application.contact.phone}` : undefined} /></div>{application.contact.message && <div className="mt-6 border-t pt-5"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Freitext</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{application.contact.message}</p></div>}</section>
        <section className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-bold">Antworten</h2><div className="mt-5 grid gap-3">{application.displayAnswers.map((answer, index) => <div key={`${answer.label}-${index}`} className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{answer.label}</p><p className="mt-2 font-semibold">{answer.values.join(", ")}</p></div>)}</div>{application.displayAnswers.length === 0 && <p className="mt-5 text-sm text-muted-foreground">Keine Antworten gespeichert.</p>}</section>
      </div>

      {application.resume && <section className="flex flex-col justify-between gap-4 rounded-2xl border bg-white p-5 shadow-sm sm:flex-row sm:items-center"><div className="flex min-w-0 items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-[#0165c3]"><FileText /></span><span className="min-w-0"><strong className="block truncate">{application.resume.fileName}</strong><small className="text-muted-foreground">{(application.resume.size / 1024 / 1024).toFixed(2)} MB</small></span></div><Button variant="outline" asChild><a href={application.resume.url} target="_blank" rel="noreferrer"><Download className="size-4" />Lebenslauf öffnen</a></Button></section>}

      <section className="rounded-2xl border bg-white p-5 text-xs text-muted-foreground shadow-sm"><h2 className="font-bold text-foreground">Technische Angaben</h2><dl className="mt-4 grid gap-2 sm:grid-cols-2"><div><dt className="font-semibold">Funnel</dt><dd>{funnel?.title ?? application.funnelSlug} · /f/{application.funnelSlug}</dd></div><div><dt className="font-semibold">Einwilligung</dt><dd>{new Date(application.consentAt).toLocaleString("de-DE")}</dd></div><div className="sm:col-span-2"><dt className="font-semibold">Quelle</dt><dd className="break-all">{application.sourceUrl || "–"}</dd></div></dl></section>
    </div>
  );
}

function Contact({ icon: Icon, label, value, href }: { icon: typeof UserRound; label: string; value?: string; href?: string }) {
  const content = <><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500"><Icon className="size-4" /></span><span className="min-w-0"><small className="block text-xs text-muted-foreground">{label}</small><strong className="block truncate text-sm">{value || "–"}</strong></span></>;
  return href ? <a className="flex items-center gap-3 rounded-xl transition hover:text-[#0165c3]" href={href}>{content}</a> : <div className="flex items-center gap-3">{content}</div>;
}
