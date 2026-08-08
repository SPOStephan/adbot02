import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, ChevronDown, Copy, ExternalLink, GripVertical, ImageIcon, Loader2, Save, Search, Settings2, Trash2, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { useLocation, useParams } from "wouter";
import { FUNNEL_OPTION_ICON_LABELS, FUNNEL_OPTION_ICONS } from "@shared/funnel";
import type { ContactPage, FunnelConfig, FunnelOptionIcon, FunnelPage } from "@shared/funnel";
import { deleteFunnelPage, duplicateFunnelPage, moveFunnelPage } from "@shared/funnelEditor";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EditorPreview } from "@/components/admin/EditorPreview";
import { FunnelIcon } from "@/components/funnel/FunnelIcon";
import { formatHexColorDraft, normalizeHexColor } from "@/lib/hexColor";
import { getNextIconGridIndex, isIconActivationKey } from "@/lib/iconKeyboard";

const pageLabels: Record<FunnelPage["type"], string> = { start: "Startseite", "choice-grid": "Symbolkacheln", "choice-list": "Buttonliste", contact: "Kontaktformular" };

function FormRow({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <div className="grid gap-2"><Label>{label}</Label>{children}{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>;
}

function ColorField({ label, value, onChange, hint }: { label: string; value: string; onChange: (value: string) => void; hint?: string }) {
  const [draft, setDraft] = useState(value.toUpperCase());
  useEffect(() => setDraft(value.toUpperCase()), [value]);
  const valid = normalizeHexColor(draft);
  const updateDraft = (input: string) => {
    const next = formatHexColorDraft(input);
    setDraft(next);
    const normalized = normalizeHexColor(next);
    if (normalized && normalized !== value.toUpperCase()) onChange(normalized);
  };
  return <FormRow label={label} hint={hint}><div className={`grid gap-1.5 rounded-xl border bg-slate-50 p-2 ${draft && !valid ? "border-amber-400" : ""}`}><div className="flex items-center gap-2"><Input className="h-10 w-12 shrink-0 cursor-pointer border-0 bg-transparent p-0" type="color" value={value} aria-label={`${label} visuell auswählen`} onChange={event => onChange(event.target.value.toUpperCase())} /><Input className="h-10 min-w-0 bg-white font-mono text-sm font-semibold uppercase" value={draft} placeholder="#0165C3" maxLength={7} spellCheck={false} inputMode="text" aria-label={`${label} als Hexwert`} aria-invalid={Boolean(draft && !valid)} onChange={event => updateDraft(event.target.value)} onBlur={() => setDraft(value.toUpperCase())} /></div>{draft && !valid && <p className="px-1 text-[11px] font-medium text-amber-700" role="status">Vollständigen Hexwert im Format #RRGGBB eingeben.</p>}</div></FormRow>;
}

function IconPicker({ value, onChange }: { value: FunnelOptionIcon; onChange: (value: FunnelOptionIcon) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const iconButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const normalizedSearch = search.trim().toLocaleLowerCase("de");
  const filteredIcons = FUNNEL_OPTION_ICONS.filter(icon => `${FUNNEL_OPTION_ICON_LABELS[icon]} ${icon}`.toLocaleLowerCase("de").includes(normalizedSearch));
  const selectIcon = (icon: FunnelOptionIcon) => { onChange(icon); setOpen(false); };
  const handleIconKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number, icon: FunnelOptionIcon) => {
    if (isIconActivationKey(event.key)) {
      event.preventDefault();
      selectIcon(icon);
      return;
    }
    const grid = event.currentTarget.parentElement;
    const columnCount = grid ? window.getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length : 3;
    const nextIndex = getNextIconGridIndex({ currentIndex: index, key: event.key, itemCount: filteredIcons.length, columnCount });
    if (nextIndex === null || nextIndex === index) return;
    event.preventDefault();
    iconButtonRefs.current[nextIndex]?.focus();
  };
  return (
    <Popover open={open} onOpenChange={next => { setOpen(next); if (!next) setSearch(""); }}>
      <PopoverTrigger asChild><Button type="button" variant="outline" className="h-9 min-w-0 justify-between gap-2 bg-white px-2.5" aria-label={`Icon auswählen, aktuell ${FUNNEL_OPTION_ICON_LABELS[value]}`}><span className="flex min-w-0 items-center gap-2"><FunnelIcon name={value} className="size-4 shrink-0 text-[#0165c3]" /><span className="truncate text-xs">{FUNNEL_OPTION_ICON_LABELS[value]}</span></span><ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /></Button></PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,430px)] p-3">
        <div className="mb-3"><p className="font-semibold">Icon auswählen</p><p className="text-xs text-muted-foreground">{FUNNEL_OPTION_ICONS.length} Symbole mit direkter Vorschau</p></div>
        <div className="relative mb-3"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input autoFocus className="pl-9" value={search} placeholder="Icon suchen …" aria-label="Icons durchsuchen" onChange={event => setSearch(event.target.value)} /></div>
        <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4" role="group" aria-label="Verfügbare Icons">
          {filteredIcons.map((icon, index) => <button key={icon} ref={element => { iconButtonRefs.current[index] = element; }} type="button" aria-label={`${FUNNEL_OPTION_ICON_LABELS[icon]} auswählen`} aria-pressed={value === icon} title={FUNNEL_OPTION_ICON_LABELS[icon]} onClick={() => selectIcon(icon)} onKeyDown={event => handleIconKeyDown(event, index, icon)} className={`grid min-h-20 place-items-center gap-1 rounded-xl border p-2 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0165c3] ${value === icon ? "border-[#0165c3] bg-[#0165c3]/10 text-[#0165c3] shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-[#0165c3]/40 hover:bg-slate-50"}`}><FunnelIcon name={icon} className="size-6" /><span className="line-clamp-2 text-[10px] font-semibold leading-tight">{FUNNEL_OPTION_ICON_LABELS[icon]}</span></button>)}
        </div>
        {filteredIcons.length === 0 && <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-sm text-muted-foreground">Kein passendes Icon gefunden.</p>}
      </PopoverContent>
    </Popover>
  );
}

export default function FunnelEditor() {
  const { id: funnelId } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const query = trpc.funnel.adminConfig.useQuery(funnelId ? { id: funnelId } : undefined, { enabled: Boolean(funnelId) });
  const utils = trpc.useUtils();
  const save = trpc.funnel.saveConfig.useMutation({
    onSuccess: async saved => { setConfig(saved); setDirty(false); await Promise.all([utils.funnel.adminConfig.invalidate({ id: saved.id }), utils.funnel.funnels.invalidate()]); toast.success("Funnel gespeichert"); },
    onError: error => toast.error(error.message),
  });
  const [config, setConfig] = useState<FunnelConfig>();
  const [selectedId, setSelectedId] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty]);

  useEffect(() => {
    if (!query.data?.config) return;
    setConfig(query.data.config);
    setSelectedId(query.data.config.pages[0]?.id ?? "");
    setDirty(false);
  }, [query.data?.config]);

  const selectedPage = useMemo(() => config?.pages.find(page => page.id === selectedId) ?? config?.pages[0], [config, selectedId]);
  const changeConfig = (updater: (current: FunnelConfig) => FunnelConfig) => {
    setConfig(current => current ? updater(current) : current);
    setDirty(true);
  };
  const faviconUpload = trpc.funnel.uploadFavicon.useMutation({
    onSuccess: uploaded => {
      changeConfig(current => ({ ...current, brand: { ...current.brand, faviconUrl: uploaded.url } }));
      toast.success("Favicon hochgeladen – bitte den Funnel noch speichern.");
    },
    onError: error => toast.error(error.message),
  });
  const selectFavicon = async (file?: File) => {
    if (!file || !config) return;
    const mimeType = file.type === "image/png" ? "image/png" : /\.ico$/i.test(file.name) ? "image/x-icon" : "";
    if (!mimeType) { toast.error("Bitte eine PNG- oder ICO-Datei auswählen."); return; }
    if (file.size > 512 * 1024) { toast.error("Das Favicon darf maximal 512 KB groß sein."); return; }
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      faviconUpload.mutate({ funnelId: config.id, fileName: file.name, mimeType, size: file.size, dataBase64 });
    } catch {
      toast.error("Die Favicon-Datei konnte nicht gelesen werden.");
    }
  };
  const patchPage = (patch: Partial<FunnelPage>) => changeConfig(current => ({ ...current, pages: current.pages.map(page => page.id === selectedId ? ({ ...page, ...patch } as FunnelPage) : page) }));
  const navigateSafely = (path: string) => {
    if (dirty && !window.confirm("Ungespeicherte Änderungen verwerfen?")) return;
    setLocation(path);
  };

  if (!funnelId) return <div className="grid min-h-[60vh] place-items-center gap-3 p-6 text-center" role="alert"><div><p className="font-semibold text-destructive">Keine Funnel-ID angegeben.</p><Button className="mt-4" variant="outline" onClick={() => setLocation("/admin")}>Zur Funnel-Bibliothek</Button></div></div>;
  if (query.error) return <div className="grid min-h-[60vh] place-items-center gap-3 p-6 text-center" role="alert"><div><p className="font-semibold text-destructive">{query.error.message}</p><Button className="mt-4" variant="outline" onClick={() => setLocation("/admin")}>Zur Funnel-Bibliothek</Button></div></div>;
  if (query.isLoading || !config || !selectedPage) return <div className="min-h-[60vh] grid place-items-center text-muted-foreground" role="status" aria-live="polite"><span className="flex items-center gap-2 text-sm"><Loader2 className="animate-spin" aria-hidden="true" />Editor wird geladen …</span></div>;

  const selectedIndex = config.pages.findIndex(page => page.id === selectedPage.id);
  const duplicate = () => {
    const next = duplicateFunnelPage(config, selectedPage.id);
    const newPage = next.pages[selectedIndex + 1];
    setConfig(next); setSelectedId(newPage?.id ?? selectedId); setDirty(true);
  };
  const remove = () => {
    if (!window.confirm(`Seite „${selectedPage.name}“ wirklich löschen?`)) return;
    const next = deleteFunnelPage(config, selectedPage.id);
    if (next === config) { toast.error("Start- und Kontaktseite können nicht gelöscht werden."); return; }
    setConfig(next); setSelectedId(next.pages[Math.max(0, selectedIndex - 1)]?.id ?? ""); setDirty(true);
  };
  const move = (direction: -1 | 1) => { setConfig(moveFunnelPage(config, selectedPage.id, direction)); setDirty(true); };

  return (
    <div className="min-h-[calc(100vh-2rem)] -m-4 bg-slate-50">
      <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b bg-white/95 px-5 py-3 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3"><Button variant="ghost" size="icon" aria-label="Zur Funnel-Bibliothek" onClick={() => navigateSafely("/admin")}><ArrowLeft className="size-4" /></Button><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[.14em] text-[#0165c3]">Funnel Studio</p><h1 className="truncate text-lg font-bold tracking-tight">{config.title}</h1></div></div>
        <div className="flex items-center gap-2">
          {dirty && <span className="hidden text-xs text-amber-700 sm:inline">Ungespeicherte Änderungen</span>}
          {save.error && <span className="hidden max-w-52 truncate text-xs text-destructive lg:inline" role="alert">{save.error.message}</span>}
          <Button variant="outline" onClick={() => navigateSafely(`/admin/funnels/${config.id}/settings`)}><Settings2 className="size-4" />Einstellungen</Button>
          <Button variant="outline" asChild={config.status === "published"} disabled={config.status !== "published"}>{config.status === "published" ? <a href={`/f/${config.slug}`} target="_blank" rel="noreferrer"><ExternalLink className="size-4" />Öffnen</a> : <span title="Veröffentliche den Funnel zuerst"><ExternalLink className="size-4" />Nicht öffentlich</span>}</Button>
          <Button className="bg-[#0165c3] hover:bg-[#004d98]" disabled={!dirty || save.isPending} aria-busy={save.isPending} onClick={() => save.mutate(config)}>{save.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}Speichern</Button>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-76px)] xl:grid-cols-[240px_minmax(330px,480px)_minmax(420px,1fr)]">
        <aside className="border-r bg-white p-3">
          <div className="mb-3 flex items-center justify-between px-2"><span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Seiten</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{config.pages.length}</span></div>
          <div className="grid gap-1.5">
            {config.pages.map((page, index) => (
              <button key={page.id} type="button" aria-pressed={selectedPage.id === page.id} onClick={() => setSelectedId(page.id)} className={`group flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0165c3] ${selectedPage.id === page.id ? "border-[#0165c3]/30 bg-[#0165c3]/8 shadow-sm" : "border-transparent hover:bg-slate-50"}`}>
                <GripVertical className="size-4 shrink-0 text-slate-300" /><span className={`grid size-7 shrink-0 place-items-center rounded-lg text-xs font-bold ${selectedPage.id === page.id ? "bg-[#0165c3] text-white" : "bg-slate-100 text-slate-500"}`}>{index + 1}</span>
                <span className="min-w-0"><strong className="block truncate text-sm">{page.name}</strong><small className="block truncate text-[10px] text-muted-foreground">{pageLabels[page.type]}</small></span>
              </button>
            ))}
          </div>
        </aside>

        <section className="border-r bg-white p-5">
          <Tabs defaultValue="page">
            <TabsList className="mb-5 grid w-full grid-cols-2"><TabsTrigger value="page">Seite</TabsTrigger><TabsTrigger value="global"><Settings2 className="size-3.5" />Global</TabsTrigger></TabsList>
            <TabsContent value="page" className="mt-0 grid gap-5">
              <div className="flex items-center justify-between gap-2"><div><p className="text-xs text-muted-foreground">{pageLabels[selectedPage.type]}</p><h2 className="font-bold">{selectedPage.name}</h2></div><div className="flex gap-1"><Button size="icon" variant="ghost" title="Nach oben" disabled={selectedIndex <= 1 || selectedPage.type === "contact"} onClick={() => move(-1)}><ArrowUp className="size-4" /></Button><Button size="icon" variant="ghost" title="Nach unten" disabled={selectedIndex >= config.pages.length - 2 || selectedPage.type === "start"} onClick={() => move(1)}><ArrowDown className="size-4" /></Button><Button size="icon" variant="ghost" title="Duplizieren" onClick={duplicate}><Copy className="size-4" /></Button><Button size="icon" variant="ghost" className="text-destructive" title="Löschen" disabled={selectedPage.type === "start" || selectedPage.type === "contact"} onClick={remove}><Trash2 className="size-4" /></Button></div></div>
              <FormRow label="Interner Seitenname"><Input value={selectedPage.name} onChange={event => patchPage({ name: event.target.value })} /></FormRow>
              <FormRow label="Überzeile (optional)" hint="Leer lassen, um diesen Bereich vollständig auszublenden."><Input value={selectedPage.eyebrow} placeholder="Zum Beispiel: Kurze Frage" onChange={event => patchPage({ eyebrow: event.target.value } as Partial<FunnelPage>)} /></FormRow>
              <FormRow label="Überschrift"><Textarea value={selectedPage.title} rows={2} onChange={event => patchPage({ title: event.target.value })} /></FormRow>
              <FormRow label="Beschreibung"><Textarea value={selectedPage.description} rows={3} onChange={event => patchPage({ description: event.target.value })} /></FormRow>
              <FormRow label="Button-Beschriftung"><Input value={selectedPage.buttonLabel} onChange={event => patchPage({ buttonLabel: event.target.value })} /></FormRow>

              {selectedPage.type === "start" && <>
                <FormRow label="Bild-URL" hint="Leer lassen, um die neutrale Illustration zu verwenden."><Input value={selectedPage.heroImageUrl} onChange={event => patchPage({ heroImageUrl: event.target.value } as Partial<FunnelPage>)} /></FormRow>
                <FormRow label="Vorteile – eine Zeile pro Punkt"><Textarea value={selectedPage.bullets.join("\n")} rows={4} onChange={event => patchPage({ bullets: event.target.value.split("\n").filter(Boolean) } as Partial<FunnelPage>)} /></FormRow>
                <FormRow label="Hinweis unter dem Button"><Input value={selectedPage.trustNote} onChange={event => patchPage({ trustNote: event.target.value } as Partial<FunnelPage>)} /></FormRow>
              </>}

              {(selectedPage.type === "choice-grid" || selectedPage.type === "choice-list") && <>
                <label className="flex items-center justify-between rounded-xl border p-3"><span><strong className="block text-sm">Mehrfachauswahl</strong><small className="text-muted-foreground">Mehrere Antworten erlauben</small></span><Switch checked={selectedPage.allowMultiple} onCheckedChange={checked => patchPage({ allowMultiple: checked } as Partial<FunnelPage>)} /></label>
                <div className="grid gap-3"><div className="flex items-center justify-between"><Label>Antwortoptionen</Label><Button size="sm" variant="outline" onClick={() => patchPage({ options: [...selectedPage.options, { id: crypto.randomUUID(), label: "Neue Option", value: `option-${selectedPage.options.length + 1}`, icon: "sparkles" }] } as Partial<FunnelPage>)}>Option hinzufügen</Button></div>
                  {selectedPage.options.map((option, optionIndex) => <div className="grid gap-2 rounded-xl border bg-slate-50 p-3" key={option.id}><div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_170px_auto]"><Input value={option.label} onChange={event => patchPage({ options: selectedPage.options.map(item => item.id === option.id ? { ...item, label: event.target.value, value: event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || item.value } : item) } as Partial<FunnelPage>)} /><IconPicker value={option.icon} onChange={icon => patchPage({ options: selectedPage.options.map(item => item.id === option.id ? { ...item, icon } : item) } as Partial<FunnelPage>)} /><Button size="icon" variant="ghost" className="shrink-0 text-destructive" aria-label={`Option ${option.label} löschen`} disabled={selectedPage.options.length <= 2} onClick={() => patchPage({ options: selectedPage.options.filter((_, index) => index !== optionIndex) } as Partial<FunnelPage>)}><Trash2 className="size-4" /></Button></div><Input placeholder="Optionale Kurzbeschreibung" value={option.description ?? ""} onChange={event => patchPage({ options: selectedPage.options.map(item => item.id === option.id ? { ...item, description: event.target.value } : item) } as Partial<FunnelPage>)} /></div>)}
                </div>
              </>}

              {selectedPage.type === "contact" && <ContactEditor page={selectedPage} patch={patchPage} />}
            </TabsContent>

            <TabsContent value="global" className="mt-0 grid gap-5">
              <label className="flex items-center justify-between rounded-xl border p-3"><span><strong className="block text-sm">Funnel veröffentlicht</strong><small className="text-muted-foreground">Öffentliche URL aktivieren; Ausschalten pausiert einen laufenden Funnel</small></span><Switch checked={config.status === "published"} disabled={config.status === "archived"} onCheckedChange={checked => changeConfig(current => ({ ...current, status: checked ? "published" : current.status === "published" ? "paused" : current.status, isPublished: checked }))} /></label>
              <FormRow label="Funnel-Titel"><Input value={config.title} onChange={event => changeConfig(current => ({ ...current, title: event.target.value }))} /></FormRow>
              <FormRow label="URL-Slug"><Input value={config.slug} onChange={event => changeConfig(current => ({ ...current, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))} /></FormRow>
              <div className="grid gap-4 rounded-2xl border bg-slate-50/70 p-4">
                <div><p className="text-sm font-bold">Logo & Browser-Icon</p><p className="text-xs text-muted-foreground">Diese Angaben gelten nur für diesen Funnel.</p></div>
                <FormRow label="Logo-URL"><Input value={config.brand.logoUrl} onChange={event => changeConfig(current => ({ ...current, brand: { ...current.brand, logoUrl: event.target.value } }))} /></FormRow>
                <FormRow label="Logo-Alternativtext"><Input value={config.brand.logoAlt} onChange={event => changeConfig(current => ({ ...current, brand: { ...current.brand, logoAlt: event.target.value } }))} /></FormRow>
                <div className="grid gap-3 sm:grid-cols-[72px_minmax(0,1fr)]">
                  <div className="grid size-[72px] place-items-center overflow-hidden rounded-2xl border bg-white shadow-sm">{config.brand.faviconUrl ? <img className="size-10 object-contain" src={config.brand.faviconUrl} alt="Favicon-Vorschau" /> : <ImageIcon className="size-7 text-slate-400" aria-hidden="true" />}</div>
                  <div className="grid gap-3">
                    <FormRow label="Favicon-URL" hint="PNG oder ICO; empfohlen sind quadratische 32 × 32 oder 48 × 48 Pixel."><Input value={config.brand.faviconUrl} placeholder="https://…/favicon.png" onChange={event => changeConfig(current => ({ ...current, brand: { ...current.brand, faviconUrl: event.target.value } }))} /></FormRow>
                    <div className="flex flex-wrap gap-2"><label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-white px-3 text-sm font-medium shadow-xs transition hover:bg-slate-100"><UploadCloud className="size-4" />{faviconUpload.isPending ? "Wird hochgeladen …" : "PNG/ICO hochladen"}<input className="sr-only" type="file" accept=".png,.ico,image/png,image/x-icon,image/vnd.microsoft.icon" disabled={faviconUpload.isPending} onChange={event => { void selectFavicon(event.target.files?.[0]); event.target.value = ""; }} /></label>{config.brand.faviconUrl && <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => changeConfig(current => ({ ...current, brand: { ...current.brand, faviconUrl: "" } }))}><X className="size-4" />Entfernen</Button>}</div>
                  </div>
                </div>
              </div>
              <div className="grid gap-4 rounded-2xl border p-4">
                <div><p className="text-sm font-bold">Grundfarben</p><p className="text-xs text-muted-foreground">Hintergrund und Text des gesamten Funnels.</p></div>
                <FormRow label="Akzentfarbe" hint="Verbindliche Markenfarbe für Buttons und Fortschritt."><div className="flex items-center gap-3"><span className="size-10 rounded-xl border shadow-sm" style={{ background: "#0165c3" }} /><Input value="#0165c3" readOnly /></div></FormRow>
                <div className="grid grid-cols-2 gap-3"><ColorField label="Hintergrund" value={config.brand.backgroundColor} onChange={value => changeConfig(current => ({ ...current, brand: { ...current.brand, backgroundColor: value } }))} /><ColorField label="Textfarbe" value={config.brand.textColor} onChange={value => changeConfig(current => ({ ...current, brand: { ...current.brand, textColor: value } }))} /></div>
              </div>
              <div className="grid gap-4 rounded-2xl border p-4">
                <div><p className="text-sm font-bold">Klickbare Antwortkästen</p><p className="text-xs text-muted-foreground">Normale und ausgewählte Zustände lassen sich getrennt gestalten. In der Vorschau können Sie eine Antwort anklicken.</p></div>
                <div className="grid grid-cols-2 gap-3"><ColorField label="Kasten" value={config.brand.choiceBackgroundColor} onChange={value => changeConfig(current => ({ ...current, brand: { ...current.brand, choiceBackgroundColor: value } }))} /><ColorField label="Kasten-Text" value={config.brand.choiceTextColor} onChange={value => changeConfig(current => ({ ...current, brand: { ...current.brand, choiceTextColor: value } }))} /><ColorField label="Auswahl" value={config.brand.choiceSelectedBackgroundColor} onChange={value => changeConfig(current => ({ ...current, brand: { ...current.brand, choiceSelectedBackgroundColor: value } }))} /><ColorField label="Auswahl-Text" value={config.brand.choiceSelectedTextColor} onChange={value => changeConfig(current => ({ ...current, brand: { ...current.brand, choiceSelectedTextColor: value } }))} /><ColorField label="Auswahl-Rahmen" value={config.brand.choiceSelectedBorderColor} onChange={value => changeConfig(current => ({ ...current, brand: { ...current.brand, choiceSelectedBorderColor: value } }))} /></div>
              </div>
              <label className="flex items-center justify-between rounded-xl border p-3"><span><strong className="block text-sm">Social Proof anzeigen</strong><small className="text-muted-foreground">Vertrauenshinweis im Footer</small></span><Switch checked={config.socialProof.enabled} onCheckedChange={checked => changeConfig(current => ({ ...current, socialProof: { ...current.socialProof, enabled: checked } }))} /></label>
              <FormRow label="Social-Proof-Überschrift"><Input value={config.socialProof.eyebrow} onChange={event => changeConfig(current => ({ ...current, socialProof: { ...current.socialProof, eyebrow: event.target.value } }))} /></FormRow>
              <FormRow label="Social-Proof-Text"><Textarea value={config.socialProof.text} onChange={event => changeConfig(current => ({ ...current, socialProof: { ...current.socialProof, text: event.target.value } }))} /></FormRow>
              <FormRow label="Empfänger-E-Mail"><Input type="email" placeholder="bewerbung@unternehmen.de" value={config.notificationEmail} onChange={event => changeConfig(current => ({ ...current, notificationEmail: event.target.value }))} /></FormRow>
              <FormRow label="Datenschutz-URL"><Input type="url" value={config.privacyUrl} onChange={event => changeConfig(current => ({ ...current, privacyUrl: event.target.value }))} /></FormRow>
              <FormRow label="Erlaubte WordPress-Domains" hint="Eine vollständige https://-Adresse pro Zeile."><Textarea rows={3} value={config.allowedEmbedOrigins.join("\n")} onChange={event => changeConfig(current => ({ ...current, allowedEmbedOrigins: event.target.value.split("\n").map(value => value.trim()).filter(Boolean) }))} /></FormRow>
            </TabsContent>
          </Tabs>
        </section>

        <aside className="bg-slate-100 p-5"><div className="sticky top-24"><div className="mb-3 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Live-Vorschau</p><p className="text-sm font-semibold">Mobil · 390 px</p></div><span className="h-2 w-2 rounded-full bg-emerald-500" /></div><EditorPreview config={config} page={selectedPage} /></div></aside>
      </div>
    </div>
  );
}

function ContactEditor({ page, patch }: { page: ContactPage; patch: (value: Partial<FunnelPage>) => void }) {
  return <div className="grid gap-4"><Label>Formularfelder</Label>{page.fields.map(field => <div key={field.key} className="grid gap-3 rounded-xl border bg-slate-50 p-3"><div className="flex items-center justify-between gap-3"><strong className="text-sm">{field.key}</strong><div className="flex items-center gap-3"><label className="flex items-center gap-2 text-xs">Aktiv<Switch checked={field.enabled} onCheckedChange={enabled => patch({ fields: page.fields.map(item => item.key === field.key ? { ...item, enabled } : item) } as Partial<FunnelPage>)} /></label><label className="flex items-center gap-2 text-xs">Pflicht<Switch checked={field.required} disabled={!field.enabled} onCheckedChange={required => patch({ fields: page.fields.map(item => item.key === field.key ? { ...item, required } : item) } as Partial<FunnelPage>)} /></label></div></div><Input value={field.label} onChange={event => patch({ fields: page.fields.map(item => item.key === field.key ? { ...item, label: event.target.value } : item) } as Partial<FunnelPage>)} /><Input value={field.placeholder} onChange={event => patch({ fields: page.fields.map(item => item.key === field.key ? { ...item, placeholder: event.target.value } : item) } as Partial<FunnelPage>)} /></div>)}<FormRow label="Datenschutz-Einwilligung"><Textarea rows={3} value={page.consentLabel} onChange={event => patch({ consentLabel: event.target.value } as Partial<FunnelPage>)} /></FormRow><label className="flex items-center justify-between rounded-xl border p-3"><span><strong className="block text-sm">Lebenslauf-Upload</strong><small className="text-muted-foreground">PDF, DOC und DOCX</small></span><Switch checked={page.resumeEnabled} onCheckedChange={resumeEnabled => patch({ resumeEnabled } as Partial<FunnelPage>)} /></label>{page.resumeEnabled && <label className="flex items-center justify-between rounded-xl border p-3"><span className="text-sm font-semibold">Upload als Pflichtfeld</span><Switch checked={page.resumeRequired} onCheckedChange={resumeRequired => patch({ resumeRequired } as Partial<FunnelPage>)} /></label>}<FormRow label="Erfolgsüberschrift"><Input value={page.successTitle} onChange={event => patch({ successTitle: event.target.value } as Partial<FunnelPage>)} /></FormRow><FormRow label="Erfolgstext"><Textarea rows={3} value={page.successText} onChange={event => patch({ successText: event.target.value } as Partial<FunnelPage>)} /></FormRow></div>;
}
