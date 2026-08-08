import type { FunnelStatus, FunnelSummary } from "@shared/funnel";
import {
  Archive,
  ArrowRight,
  BriefcaseBusiness,
  Copy,
  ExternalLink,
  FilePenLine,
  Inbox,
  LayoutGrid,
  Loader2,
  MoreHorizontal,
  PauseCircle,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";

const statusLabels: Record<FunnelStatus, string> = {
  draft: "Entwurf",
  published: "Veröffentlicht",
  paused: "Pausiert",
  archived: "Archiviert",
};

const statusClasses: Record<FunnelStatus, string> = {
  draft: "bg-slate-100 text-slate-700 ring-slate-500/15",
  published: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  paused: "bg-amber-50 text-amber-800 ring-amber-600/15",
  archived: "bg-zinc-100 text-zinc-500 ring-zinc-500/15",
};

type SortKey = "updated" | "title" | "applications" | "created";

function clientSlugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export default function FunnelLibrary() {
  const [, setLocation] = useLocation();
  const query = trpc.funnel.funnels.useQuery();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<FunnelStatus | "all">("all");
  const [sort, setSort] = useState<SortKey>("updated");
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [duplicateSource, setDuplicateSource] = useState<FunnelSummary | null>(null);
  const [duplicateTitle, setDuplicateTitle] = useState("");
  const [duplicateSlug, setDuplicateSlug] = useState("");
  const [duplicateSlugTouched, setDuplicateSlugTouched] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<FunnelSummary | null>(null);

  const create = trpc.funnel.create.useMutation({
    onSuccess: async config => {
      await utils.funnel.funnels.invalidate();
      setCreateOpen(false);
      setTitle("");
      setSlug("");
      setSlugTouched(false);
      toast.success("Funnel als Entwurf angelegt");
      setLocation(`/admin/funnels/${config.id}/editor`);
    },
    onError: error => toast.error(error.message),
  });

  const duplicate = trpc.funnel.duplicate.useMutation({
    onSuccess: async config => {
      await utils.funnel.funnels.invalidate();
      setDuplicateSource(null);
      toast.success("Funnel vollständig kopiert", { description: "Bewerbungen und Dateien wurden nicht übernommen." });
      setLocation(`/admin/funnels/${config.id}/editor`);
    },
    onError: error => toast.error(error.message),
  });

  const statusChange = trpc.funnel.setFunnelStatus.useMutation({
    onMutate: async input => {
      await utils.funnel.funnels.cancel();
      const previous = utils.funnel.funnels.getData();
      utils.funnel.funnels.setData(undefined, current => current?.map(funnel => funnel.id === input.id ? {
        ...funnel,
        status: input.status,
        updatedAt: new Date().toISOString(),
      } : funnel));
      return { previous };
    },
    onError: (error, _input, context) => {
      utils.funnel.funnels.setData(undefined, context?.previous);
      toast.error(error.message);
    },
    onSuccess: config => {
      setArchiveTarget(null);
      toast.success(`${config.title}: ${statusLabels[config.status]}`);
    },
    onSettled: () => utils.funnel.funnels.invalidate(),
  });

  const funnels = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return [...(query.data ?? [])]
      .filter(funnel => status === "all" || funnel.status === status)
      .filter(funnel => !needle || funnel.title.toLowerCase().includes(needle) || funnel.slug.toLowerCase().includes(needle))
      .sort((left, right) => {
        if (sort === "title") return left.title.localeCompare(right.title, "de");
        if (sort === "applications") return right.applicationCount - left.applicationCount;
        if (sort === "created") return right.createdAt.localeCompare(left.createdAt);
        return right.updatedAt.localeCompare(left.updatedAt);
      });
  }, [query.data, search, sort, status]);

  const totals = useMemo(() => ({
    funnels: query.data?.length ?? 0,
    published: query.data?.filter(funnel => funnel.status === "published").length ?? 0,
    applications: query.data?.reduce((sum, funnel) => sum + funnel.applicationCount, 0) ?? 0,
    newApplications: query.data?.reduce((sum, funnel) => sum + funnel.newApplicationCount, 0) ?? 0,
  }), [query.data]);

  const openCreate = () => {
    create.reset();
    setTitle("");
    setSlug("");
    setSlugTouched(false);
    setCreateOpen(true);
  };

  const openDuplicate = (funnel: FunnelSummary) => {
    duplicate.reset();
    const nextTitle = `${funnel.title} – Kopie`;
    setDuplicateSource(funnel);
    setDuplicateTitle(nextTitle);
    setDuplicateSlug(clientSlugify(nextTitle));
    setDuplicateSlugTouched(false);
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-2 sm:p-4">
      <header className="relative overflow-hidden rounded-[28px] bg-[#10253f] px-5 py-7 text-white shadow-xl shadow-slate-200 sm:px-8 sm:py-9">
        <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-[#0165c3]/45 blur-2xl" />
        <div className="pointer-events-none absolute bottom-0 right-1/3 h-28 w-48 rotate-12 rounded-full bg-cyan-300/10 blur-2xl" />
        <div className="relative flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1.5 text-xs font-semibold uppercase tracking-[.16em] text-blue-100">
              <LayoutGrid className="size-3.5" aria-hidden="true" /> Funnel-Bibliothek
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Recruiting-Kampagnen zentral steuern</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">Erstelle neue Vorlagen, kopiere bewährte Abläufe und behalte Bewerbungen über alle Kampagnen hinweg im Blick.</p>
          </div>
          <Button size="lg" className="h-12 bg-white text-[#10253f] shadow-lg hover:bg-blue-50" onClick={openCreate}>
            <Plus className="size-4" aria-hidden="true" /> Neuen Funnel erstellen
          </Button>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Funnel-Kennzahlen">
        <Metric icon={BriefcaseBusiness} label="Funnels gesamt" value={totals.funnels} detail={`${totals.published} veröffentlicht`} />
        <Metric icon={Sparkles} label="Aktive Kampagnen" value={totals.published} detail="öffentlich erreichbar" />
        <Metric icon={Inbox} label="Bewerbungen" value={totals.applications} detail={`${totals.newApplications} noch neu`} accent />
        <button type="button" className="group flex min-h-28 items-center gap-4 rounded-2xl border border-dashed border-[#0165c3]/35 bg-blue-50/50 p-5 text-left transition hover:border-[#0165c3] hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0165c3]" onClick={openCreate}>
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#0165c3] text-white shadow-md shadow-blue-200"><Plus className="size-5" /></span>
          <span><strong className="block text-sm text-[#10253f]">Neue Vorlage</strong><small className="mt-1 block leading-5 text-muted-foreground">Mit einer neutralen Funnel-Struktur starten</small></span>
        </button>
      </section>

      <section className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input className="h-11 pl-9" placeholder="Titel oder URL-Slug suchen …" aria-label="Funnels durchsuchen" value={search} onChange={event => setSearch(event.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Select value={status} onValueChange={value => setStatus(value as FunnelStatus | "all")}><SelectTrigger className="h-11 sm:w-44" aria-label="Funnelstatus filtern"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alle Status</SelectItem><SelectItem value="published">Veröffentlicht</SelectItem><SelectItem value="draft">Entwürfe</SelectItem><SelectItem value="paused">Pausiert</SelectItem><SelectItem value="archived">Archiviert</SelectItem></SelectContent></Select>
            <Select value={sort} onValueChange={value => setSort(value as SortKey)}><SelectTrigger className="h-11 sm:w-48" aria-label="Funnels sortieren"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="updated">Zuletzt bearbeitet</SelectItem><SelectItem value="created">Zuletzt erstellt</SelectItem><SelectItem value="title">Titel A–Z</SelectItem><SelectItem value="applications">Meiste Bewerbungen</SelectItem></SelectContent></Select>
          </div>
        </div>

        {query.isLoading ? <LibraryLoading /> : query.error ? <div className="p-10 text-center text-destructive" role="alert">{query.error.message}</div> : funnels.length === 0 ? <LibraryEmpty hasAny={(query.data?.length ?? 0) > 0} onCreate={openCreate} /> : <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-2 2xl:grid-cols-3">{funnels.map(funnel => <FunnelCard key={funnel.id} funnel={funnel} busy={statusChange.isPending && statusChange.variables?.id === funnel.id} onNavigate={setLocation} onDuplicate={openDuplicate} onArchive={setArchiveTarget} onStatusChange={(id, nextStatus) => statusChange.mutate({ id, status: nextStatus })} />)}</div>}
      </section>

      <Dialog open={createOpen} onOpenChange={open => !create.isPending && setCreateOpen(open)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Neue Funnel-Vorlage</DialogTitle><DialogDescription>Du startest mit einer vollständig bearbeitbaren Recruiting-Vorlage. Der Funnel bleibt zunächst als Entwurf unveröffentlicht.</DialogDescription></DialogHeader>
          <form className="grid gap-5" onSubmit={event => { event.preventDefault(); if (!title.trim()) return; create.mutate({ title: title.trim(), slug: slug.trim() || undefined }); }}>
            <div className="grid gap-2"><Label htmlFor="new-funnel-title">Funnel-Titel</Label><Input id="new-funnel-title" autoFocus maxLength={240} disabled={create.isPending} placeholder="Zum Beispiel: Vertrieb München" value={title} onChange={event => { const next = event.target.value; setTitle(next); if (!slugTouched) setSlug(clientSlugify(next)); }} /><p className="text-xs text-muted-foreground">Der Titel ist nur im Admin-Bereich und im Funnel sichtbar.</p></div>
            <SlugField id="new-funnel-slug" value={slug} placeholder="vertrieb-muenchen" disabled={create.isPending} onChange={value => { setSlugTouched(true); setSlug(clientSlugify(value)); }} />
            {create.error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{create.error.message}</p>}
            <DialogFooter><Button type="button" variant="outline" disabled={create.isPending} onClick={() => setCreateOpen(false)}>Abbrechen</Button><Button type="submit" className="bg-[#0165c3] hover:bg-[#0154a3]" disabled={!title.trim() || create.isPending} aria-busy={create.isPending}>{create.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}{create.isPending ? "Vorlage wird angelegt …" : "Vorlage anlegen"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(duplicateSource)} onOpenChange={open => !open && !duplicate.isPending && setDuplicateSource(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Bestehenden Funnel kopieren</DialogTitle><DialogDescription>Alle Seiten, Texte, Optionen, Branding- und Benachrichtigungseinstellungen werden übernommen. Bewerbungen und Dateien verbleiben ausschließlich beim Original.</DialogDescription></DialogHeader>
          <form className="grid gap-5" onSubmit={event => { event.preventDefault(); if (!duplicateSource || !duplicateTitle.trim()) return; duplicate.mutate({ sourceId: duplicateSource.id, title: duplicateTitle.trim(), slug: duplicateSlug.trim() || undefined }); }}>
            <div className="rounded-xl border bg-slate-50 p-3 text-sm"><span className="text-muted-foreground">Vorlage:</span> <strong>{duplicateSource?.title}</strong></div>
            <div className="grid gap-2"><Label htmlFor="duplicate-funnel-title">Titel der Kopie</Label><Input id="duplicate-funnel-title" autoFocus maxLength={240} disabled={duplicate.isPending} value={duplicateTitle} onChange={event => { const next = event.target.value; setDuplicateTitle(next); if (!duplicateSlugTouched) setDuplicateSlug(clientSlugify(next)); }} /></div>
            <SlugField id="duplicate-funnel-slug" value={duplicateSlug} placeholder="funnel-kopie" disabled={duplicate.isPending} onChange={value => { setDuplicateSlugTouched(true); setDuplicateSlug(clientSlugify(value)); }} />
            {duplicate.error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{duplicate.error.message}</p>}
            <DialogFooter><Button type="button" variant="outline" disabled={duplicate.isPending} onClick={() => setDuplicateSource(null)}>Abbrechen</Button><Button type="submit" className="bg-[#0165c3] hover:bg-[#0154a3]" disabled={!duplicateTitle.trim() || duplicate.isPending} aria-busy={duplicate.isPending}>{duplicate.isPending ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}{duplicate.isPending ? "Kopie wird angelegt …" : "Funnel kopieren"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(archiveTarget)} onOpenChange={open => !open && !statusChange.isPending && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Funnel archivieren?</AlertDialogTitle><AlertDialogDescription>„{archiveTarget?.title}“ ist danach öffentlich nicht erreichbar und wird in der Bibliothek unter „Archiviert“ geführt. Bewerbungen und Konfiguration bleiben erhalten; du kannst den Funnel jederzeit als Entwurf wiederherstellen.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={statusChange.isPending}>Abbrechen</AlertDialogCancel><AlertDialogAction className="bg-slate-900 text-white hover:bg-slate-800" disabled={statusChange.isPending} onClick={() => archiveTarget && statusChange.mutate({ id: archiveTarget.id, status: "archived" })}>{statusChange.isPending && <Loader2 className="size-4 animate-spin" />}{statusChange.isPending ? "Wird archiviert …" : "Archivieren"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SlugField({ id, value, placeholder, disabled = false, onChange }: { id: string; value: string; placeholder: string; disabled?: boolean; onChange: (value: string) => void }) {
  return <div className="grid gap-2"><Label htmlFor={id}>URL-Slug</Label><div className="flex items-center overflow-hidden rounded-md border bg-slate-50 focus-within:ring-2 focus-within:ring-ring"><span className="shrink-0 pl-3 text-xs text-muted-foreground">/f/</span><Input id={id} className="border-0 bg-transparent pl-0 shadow-none focus-visible:ring-0" maxLength={120} disabled={disabled} placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)} /></div><p className="text-xs text-muted-foreground">Bei einer Kollision ergänzt der Server automatisch eine fortlaufende Nummer.</p></div>;
}

function Metric({ icon: Icon, label, value, detail, accent = false }: { icon: typeof Inbox; label: string; value: number; detail: string; accent?: boolean }) {
  return <div className={`flex min-h-28 items-center gap-4 rounded-2xl border p-5 shadow-sm ${accent ? "border-blue-200 bg-blue-50/70" : "bg-white"}`}><span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${accent ? "bg-[#0165c3] text-white" : "bg-slate-100 text-slate-600"}`}><Icon className="size-5" aria-hidden="true" /></span><div><span className="text-xs font-semibold text-muted-foreground">{label}</span><strong className="mt-1 block text-2xl tracking-tight">{value}</strong><small className="text-xs text-muted-foreground">{detail}</small></div></div>;
}

function FunnelCard({ funnel, busy, onNavigate, onDuplicate, onArchive, onStatusChange }: { funnel: FunnelSummary; busy: boolean; onNavigate: (path: string) => void; onDuplicate: (funnel: FunnelSummary) => void; onArchive: (funnel: FunnelSummary) => void; onStatusChange: (id: string, status: FunnelStatus) => void }) {
  return <article className={`group relative overflow-hidden rounded-2xl border p-5 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg ${funnel.status === "archived" ? "bg-slate-50/70 opacity-80" : "bg-white"}`}>
    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#0165c3] via-cyan-400 to-transparent opacity-0 transition group-hover:opacity-100" />
    <div className="flex items-start justify-between gap-4"><div className="min-w-0"><span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${statusClasses[funnel.status]}`}>{busy && <Loader2 className="mr-1 size-3 animate-spin" />}{statusLabels[funnel.status]}</span><h2 className="mt-3 truncate text-lg font-bold tracking-tight text-[#10253f]">{funnel.title}</h2><p className="mt-1 truncate font-mono text-xs text-muted-foreground">/f/{funnel.slug}</p></div><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" disabled={busy} aria-label={`Aktionen für ${funnel.title}`} aria-busy={busy}><MoreHorizontal className="size-5" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-56"><DropdownMenuLabel>Funnel-Aktionen</DropdownMenuLabel><DropdownMenuItem onSelect={() => onDuplicate(funnel)}><Copy className="size-4" />Funnel kopieren</DropdownMenuItem><DropdownMenuItem onSelect={() => onNavigate(`/admin/funnels/${funnel.id}/settings`)}><Settings2 className="size-4" />Einstellungen</DropdownMenuItem>{funnel.status === "published" && <DropdownMenuItem onSelect={() => window.open(`/f/${funnel.slug}`, "_blank", "noopener,noreferrer")}><ExternalLink className="size-4" />Öffentlich öffnen</DropdownMenuItem>}<DropdownMenuSeparator />{funnel.status === "published" ? <DropdownMenuItem onSelect={() => onStatusChange(funnel.id, "paused")}><PauseCircle className="size-4" />Pausieren</DropdownMenuItem> : funnel.status === "archived" ? <DropdownMenuItem onSelect={() => onStatusChange(funnel.id, "draft")}><RotateCcw className="size-4" />Als Entwurf wiederherstellen</DropdownMenuItem> : <DropdownMenuItem onSelect={() => onStatusChange(funnel.id, "published")}><Play className="size-4" />Veröffentlichen</DropdownMenuItem>}{funnel.status !== "archived" && <DropdownMenuItem className="text-slate-700" onSelect={() => onArchive(funnel)}><Archive className="size-4" />Archivieren</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu></div>
    <dl className="mt-5 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3"><div><dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Gesamt</dt><dd className="mt-1 font-bold">{funnel.applicationCount}</dd></div><div><dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Neu</dt><dd className="mt-1 font-bold text-[#0165c3]">{funnel.newApplicationCount}</dd></div><div><dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Geändert</dt><dd className="mt-1 text-xs font-semibold">{new Date(funnel.updatedAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}</dd></div></dl>
    <div className="mt-4 flex gap-2"><Button className="flex-1 bg-[#10253f] hover:bg-[#183553]" onClick={() => onNavigate(`/admin/funnels/${funnel.id}/editor`)}><FilePenLine className="size-4" />Bearbeiten</Button><Button variant="outline" onClick={() => onNavigate(`/admin/funnels/${funnel.id}/applications`)}><Inbox className="size-4" />Bewerbungen</Button></div>
  </article>;
}

function LibraryLoading() {
  return <div className="grid min-h-80 place-items-center" role="status" aria-live="polite"><span className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-5 animate-spin text-[#0165c3]" aria-hidden="true" />Funnel werden geladen …</span></div>;
}

function LibraryEmpty({ hasAny, onCreate }: { hasAny: boolean; onCreate: () => void }) {
  return <div className="grid min-h-80 place-items-center p-8 text-center" role="status"><div><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-blue-50 text-[#0165c3]"><LayoutGrid /></span><h2 className="mt-4 text-lg font-bold">{hasAny ? "Keine passenden Funnel" : "Deine Funnel-Bibliothek ist bereit"}</h2><p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{hasAny ? "Passe Suche, Filter oder Sortierung an." : "Lege deinen ersten zusätzlichen Funnel aus einer neutralen Vorlage an."}</p>{!hasAny && <Button className="mt-5 bg-[#0165c3] hover:bg-[#0154a3]" onClick={onCreate}>Ersten Funnel anlegen <ArrowRight className="size-4" /></Button>}</div></div>;
}
