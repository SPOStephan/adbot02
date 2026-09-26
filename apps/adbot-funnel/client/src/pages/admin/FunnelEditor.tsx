import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Copy, ExternalLink, Eye, EyeOff, GripVertical, ImageIcon, Loader2, Save, Settings2, Trash2, Undo2, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { useLocation, useParams } from "wouter";
import { canHideFunnelPage, isFunnelPageHidden, type ContactPage, type FunnelConfig, type FunnelPage, type StartPage } from "@shared/funnel";
import { deleteFunnelPage, duplicateFunnelPage, moveFunnelPage, toggleFunnelPageHidden } from "@shared/funnelEditor";
import { DEFAULT_PROGRESS, resolveProgressColors, resolveProgressLayout } from "@shared/progressLayout";
import { benefitsFromBullets, emptyStartBenefit, MAX_START_BENEFITS, resolveBenefitsTileGap, resolveBenefitsTileLayout, resolveStartLayout } from "@shared/startLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BrandColorField } from "@/components/admin/BrandColorField";
import { EditorPreview } from "@/components/admin/EditorPreview";
import { HeroBackgroundField } from "@/components/admin/HeroBackgroundField";
import { IconColorField } from "@/components/admin/IconColorField";
import { FormattedTextField } from "@/components/admin/FormattedTextField";
import { IconPicker } from "@/components/admin/IconPicker";
import { FunnelLibraryIconSync } from "@/components/funnel/FunnelLibraryIconSync";
import { stripFormattedText } from "@shared/formattedText";
import { ProgressLayoutPicker } from "@/components/admin/ProgressLayoutPicker";
import { BenefitsTileGapPicker } from "@/components/admin/BenefitsTileGapPicker";
import { BenefitsTileLayoutPicker } from "@/components/admin/BenefitsTileLayoutPicker";
import { StartBadgesField } from "@/components/admin/StartBadgesField";
import { StartLayoutPicker } from "@/components/admin/StartLayoutPicker";
import { useFunnelEditorHistory } from "@/hooks/useFunnelEditorHistory";

const pageLabels: Record<FunnelPage["type"], string> = { start: "Startseite", "choice-grid": "Symbolkacheln", "choice-list": "Buttonliste", contact: "Kontaktformular" };

function FormRow({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <div className="grid gap-2"><Label>{label}</Label>{children}{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>;
}

export default function FunnelEditor() {
  const { id: funnelId } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const query = trpc.funnel.adminConfig.useQuery(funnelId ? { id: funnelId } : undefined, { enabled: Boolean(funnelId) });
  const utils = trpc.useUtils();
  const save = trpc.funnel.saveConfig.useMutation({
    onError: error => toast.error(error.message),
  });
  const [config, setConfig] = useState<FunnelConfig>();
  const [selectedId, setSelectedId] = useState("");
  const [dirty, setDirty] = useState(false);
  const [autosaveLabel, setAutosaveLabel] = useState("");
  const history = useFunnelEditorHistory();
  const loadedIdRef = useRef<string | null>(null);
  const configRef = useRef<FunnelConfig | undefined>(undefined);
  const autosaveTimerRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => { configRef.current = config; }, [config]);

  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty]);

  useEffect(() => {
    if (!query.data?.config) return;
    if (loadedIdRef.current === query.data.config.id && configRef.current) return;
    loadedIdRef.current = query.data.config.id;
    setConfig(query.data.config);
    setSelectedId(query.data.config.pages[0]?.id ?? "");
    setDirty(false);
    history.reset();
    setAutosaveLabel("");
  }, [query.data?.config]);

  const persist = (next: FunnelConfig, silent: boolean) => {
    save.mutate(next, {
      onSuccess: async () => {
        setDirty(false);
        setAutosaveLabel(silent ? "Automatisch gespeichert" : "Gespeichert");
        if (!silent) {
          toast.success("Funnel gespeichert");
          await utils.funnel.funnels.invalidate();
        }
      },
    });
  };

  const scheduleAutosave = () => {
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      const next = configRef.current;
      if (!next || save.isPending) return;
      persist(next, true);
    }, 1500);
  };

  useEffect(() => {
    intervalRef.current = window.setInterval(() => {
      const next = configRef.current;
      if (!next || !dirty || save.isPending) return;
      persist(next, true);
    }, 60_000);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    };
  }, [dirty, save.isPending]);

  const selectedPage = useMemo(() => config?.pages.find(page => page.id === selectedId) ?? config?.pages[0], [config, selectedId]);
  const changeConfig = (updater: (current: FunnelConfig) => FunnelConfig, immediate = true) => {
    setConfig(current => {
      if (!current) return current;
      history.record(current, immediate);
      return updater(current);
    });
    setDirty(true);
    scheduleAutosave();
  };
  const faviconUpload = trpc.funnel.uploadFavicon.useMutation({
    onSuccess: uploaded => {
      changeConfig(current => ({ ...current, brand: { ...current.brand, faviconUrl: uploaded.url } }));
      toast.success("Favicon hochgeladen.");
    },
    onError: error => toast.error(error.message),
  });
  const logoUpload = trpc.funnel.uploadLogo.useMutation({
    onSuccess: uploaded => {
      changeConfig(current => ({ ...current, brand: { ...current.brand, logoUrl: uploaded.url } }));
      toast.success("Logo hochgeladen.");
    },
    onError: error => toast.error(error.message),
  });
  const readImageBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const selectFavicon = async (file?: File) => {
    if (!file || !config) return;
    const mimeType = file.type === "image/png" ? "image/png" : /\.ico$/i.test(file.name) ? "image/x-icon" : "";
    if (!mimeType) { toast.error("Bitte eine PNG- oder ICO-Datei auswählen."); return; }
    if (file.size > 512 * 1024) { toast.error("Das Favicon darf maximal 512 KB groß sein."); return; }
    try {
      faviconUpload.mutate({ funnelId: config.id, fileName: file.name, mimeType, size: file.size, dataBase64: await readImageBase64(file) });
    } catch {
      toast.error("Die Favicon-Datei konnte nicht gelesen werden.");
    }
  };
  const selectLogo = async (file?: File) => {
    if (!file || !config) return;
    const mimeType = file.type === "image/png" || file.type === "image/webp" || file.type === "image/jpeg"
      ? file.type
      : /\.png$/i.test(file.name) ? "image/png"
        : /\.webp$/i.test(file.name) ? "image/webp"
          : /\.jpe?g$/i.test(file.name) ? "image/jpeg"
            : "";
    if (!mimeType) { toast.error("Bitte eine PNG-, JPG- oder WebP-Datei auswählen."); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error("Das Logo darf maximal 2 MB groß sein."); return; }
    try {
      logoUpload.mutate({ funnelId: config.id, fileName: file.name, mimeType, size: file.size, dataBase64: await readImageBase64(file) });
    } catch {
      toast.error("Die Logo-Datei konnte nicht gelesen werden.");
    }
  };
  const patchPage = (patch: Partial<FunnelPage>, immediate = true) => changeConfig(current => ({ ...current, pages: current.pages.map(page => page.id === selectedId ? ({ ...page, ...patch } as FunnelPage) : page) }), immediate);
  const navigateSafely = (path: string) => {
    if (dirty && !window.confirm("Ungespeicherte Änderungen verwerfen?")) return;
    setLocation(path);
  };

  if (!funnelId) return <div className="grid min-h-[60vh] place-items-center gap-3 p-6 text-center" role="alert"><div><p className="font-semibold text-destructive">Keine Funnel-ID angegeben.</p><Button className="mt-4" variant="outline" onClick={() => setLocation("/admin")}>Zur Funnel-Bibliothek</Button></div></div>;
  if (query.error) return <div className="grid min-h-[60vh] place-items-center gap-3 p-6 text-center" role="alert"><div><p className="font-semibold text-destructive">{query.error.message}</p><Button className="mt-4" variant="outline" onClick={() => setLocation("/admin")}>Zur Funnel-Bibliothek</Button></div></div>;
  if (query.isLoading || !config || !selectedPage) return <div className="min-h-[60vh] grid place-items-center text-muted-foreground" role="status" aria-live="polite"><span className="flex items-center gap-2 text-sm"><Loader2 className="animate-spin" aria-hidden="true" />Editor wird geladen …</span></div>;

  const selectedIndex = config.pages.findIndex(page => page.id === selectedPage.id);
  const undoLast = () => {
    const previous = history.undo();
    if (!previous) return;
    setConfig(previous);
    setSelectedId(current => previous.pages.some(page => page.id === current) ? current : previous.pages[0]?.id ?? "");
    setDirty(true);
    scheduleAutosave();
  };
  const duplicate = () => {
    changeConfig(current => {
      const next = duplicateFunnelPage(current, selectedPage.id);
      const newPage = next.pages[selectedIndex + 1];
      if (newPage) setSelectedId(newPage.id);
      return next;
    });
  };
  const remove = () => {
    if (!window.confirm(`Seite „${selectedPage.name}“ wirklich löschen?`)) return;
    changeConfig(current => {
      const next = deleteFunnelPage(current, selectedPage.id);
      if (next === current) { toast.error("Start- und Kontaktseite können nicht gelöscht werden."); return current; }
      setSelectedId(next.pages[Math.max(0, selectedIndex - 1)]?.id ?? "");
      return next;
    });
  };
  const move = (direction: -1 | 1) => { changeConfig(current => moveFunnelPage(current, selectedPage.id, direction)); };
  const toggleHidden = (pageId: string) => {
    changeConfig(current => {
      const next = toggleFunnelPageHidden(current, pageId);
      if (next === current) {
        toast.error("Start- und Kontaktseite können nicht ausgeblendet werden.");
        return current;
      }
      return next;
    });
  };
  const hiddenCount = config.pages.filter(isFunnelPageHidden).length;

  return (
    <div className="min-h-[calc(100vh-2rem)] -m-4 bg-slate-50">
      <FunnelLibraryIconSync />
      <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b bg-white/95 px-5 py-3 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3"><Button variant="ghost" size="icon" aria-label="Zur Funnel-Bibliothek" onClick={() => navigateSafely("/admin")}><ArrowLeft className="size-4" /></Button><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[.14em] text-[#0165c3]">Funnel Studio</p><h1 className="truncate text-lg font-bold tracking-tight">{config.title}</h1></div></div>
        <div className="flex items-center gap-2">
          {dirty ? <span className="hidden text-xs text-amber-700 sm:inline">Ungespeicherte Änderungen</span> : autosaveLabel && <span className="hidden text-xs text-emerald-700 sm:inline">{autosaveLabel}</span>}
          {save.error && <span className="hidden max-w-52 truncate text-xs text-destructive lg:inline" role="alert">{save.error.message}</span>}
          <Button type="button" size="icon" className="size-10 rounded-full border bg-white shadow-sm" variant="outline" aria-label="Letzten Schritt rückgängig machen" title="Rückgängig" disabled={!history.canUndo} onClick={undoLast}><Undo2 className="size-5" /></Button>
          <Button variant="outline" onClick={() => navigateSafely(`/admin/funnels/${config.id}/settings`)}><Settings2 className="size-4" />Einstellungen</Button>
          <Button variant="outline" asChild={config.status === "published"} disabled={config.status !== "published"}>{config.status === "published" ? <a href={`/f/${config.slug}`} target="_blank" rel="noreferrer"><ExternalLink className="size-4" />Öffnen</a> : <span title="Veröffentliche den Funnel zuerst"><ExternalLink className="size-4" />Nicht öffentlich</span>}</Button>
          <Button className="bg-[#0165c3] hover:bg-[#004d98]" disabled={!dirty || save.isPending} aria-busy={save.isPending} onClick={() => persist(config, false)}>{save.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}Speichern</Button>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-76px)] xl:grid-cols-[240px_minmax(330px,480px)_minmax(420px,1fr)]">
        <aside className="border-r bg-white p-3">
          <div className="mb-3 flex items-center justify-between px-2"><span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Seiten</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{hiddenCount > 0 ? `${config.pages.length - hiddenCount}/${config.pages.length}` : config.pages.length}</span></div>
          <div className="grid gap-1.5">
            {config.pages.map((page, index) => {
              const hidden = isFunnelPageHidden(page);
              const selected = selectedPage.id === page.id;
              return (
                <div key={page.id} className={`group flex min-w-0 items-center gap-1 rounded-xl border px-1.5 py-1.5 transition ${selected ? "border-[#0165c3]/30 bg-[#0165c3]/8 shadow-sm" : "border-transparent hover:bg-slate-50"} ${hidden ? "opacity-55" : ""}`}>
                  <button type="button" aria-pressed={selected} onClick={() => setSelectedId(page.id)} className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0165c3] ${hidden ? "grayscale" : ""}`}>
                    <GripVertical className="size-4 shrink-0 text-slate-300" />
                    <span className={`grid size-7 shrink-0 place-items-center rounded-lg text-xs font-bold ${selected && !hidden ? "bg-[#0165c3] text-white" : "bg-slate-100 text-slate-500"}`}>{index + 1}</span>
                    <span className="min-w-0">
                      <strong className={`block truncate text-sm ${hidden ? "text-slate-400 line-through decoration-slate-300" : ""}`}>{page.name}</strong>
                      <small className="block truncate text-[10px] text-muted-foreground">{hidden ? "Ausgeblendet" : pageLabels[page.type]}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`grid size-8 shrink-0 place-items-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0165c3] ${canHideFunnelPage(page) ? "text-slate-500 hover:bg-white hover:text-[#0165c3]" : "cursor-not-allowed text-slate-300"}`}
                    aria-label={hidden ? `Seite „${page.name}“ wieder einblenden` : `Seite „${page.name}“ ausblenden`}
                    title={canHideFunnelPage(page) ? (hidden ? "Wieder einblenden" : "Ausblenden") : "Start- und Kontaktseite bleiben sichtbar"}
                    disabled={!canHideFunnelPage(page)}
                    onClick={() => toggleHidden(page.id)}
                  >
                    {hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        <section className="border-r bg-white p-5">
          <Tabs defaultValue="page">
            <TabsList className="mb-5 grid w-full grid-cols-2"><TabsTrigger value="page">Seite</TabsTrigger><TabsTrigger value="global"><Settings2 className="size-3.5" />Global</TabsTrigger></TabsList>
            <TabsContent value="page" className="mt-0 grid gap-5">
              <div className="flex items-center justify-between gap-2"><div><p className="text-xs text-muted-foreground">{pageLabels[selectedPage.type]}{isFunnelPageHidden(selectedPage) ? " · ausgeblendet" : ""}</p><h2 className={`font-bold ${isFunnelPageHidden(selectedPage) ? "text-slate-400" : ""}`}>{selectedPage.name}</h2></div><div className="flex gap-1"><Button size="icon" variant="ghost" title="Nach oben" disabled={selectedIndex <= 1 || selectedPage.type === "contact"} onClick={() => move(-1)}><ArrowUp className="size-4" /></Button><Button size="icon" variant="ghost" title="Nach unten" disabled={selectedIndex >= config.pages.length - 2 || selectedPage.type === "start"} onClick={() => move(1)}><ArrowDown className="size-4" /></Button><Button size="icon" variant="ghost" title={isFunnelPageHidden(selectedPage) ? "Wieder einblenden" : "Ausblenden"} disabled={!canHideFunnelPage(selectedPage)} onClick={() => toggleHidden(selectedPage.id)}>{isFunnelPageHidden(selectedPage) ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</Button><Button size="icon" variant="ghost" title="Duplizieren" onClick={duplicate}><Copy className="size-4" /></Button><Button size="icon" variant="ghost" className="text-destructive" title="Löschen" disabled={selectedPage.type === "start" || selectedPage.type === "contact"} onClick={remove}><Trash2 className="size-4" /></Button></div></div>
              {isFunnelPageHidden(selectedPage) ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Diese Seite bleibt als Idee gespeichert, ist im öffentlichen Funnel aber ausgeblendet. Über das Augen-Symbol kannst du sie jederzeit wieder aktivieren.
                </div>
              ) : null}
              {selectedPage.type === "start" && (
                <StartLayoutPicker
                  value={resolveStartLayout(selectedPage)}
                  onChange={next => {
                    const seeded = next === "benefits" && selectedPage.benefits.length === 0
                      ? benefitsFromBullets(selectedPage.bullets)
                      : selectedPage.benefits;
                    const bandTitle = next === "benefits" && !selectedPage.benefitsBandTitle.trim()
                      ? "Deine Vorteile"
                      : selectedPage.benefitsBandTitle;
                    patchPage({ layout: next, benefits: seeded, benefitsBandTitle: bandTitle } as Partial<FunnelPage>);
                  }}
                />
              )}
              <FormRow label="Interner Seitenname"><Input value={selectedPage.name} onChange={event => patchPage({ name: event.target.value }, false)} /></FormRow>
              <FormRow label="Überzeile (optional)" hint="Leer lassen, um diesen Bereich vollständig auszublenden. Markieren für Fett, Kursiv, Unterstrich oder Farbe."><FormattedTextField value={selectedPage.eyebrow} placeholder="Zum Beispiel: Kurze Frage" rows={1} onChange={value => patchPage({ eyebrow: value } as Partial<FunnelPage>, false)} /></FormRow>
              <FormRow label="Überschrift" hint="Einzelne Wörter markieren und fett, kursiv, unterstrichen oder farbig setzen."><FormattedTextField value={selectedPage.title} rows={2} onChange={value => patchPage({ title: value }, false)} /></FormRow>
              <FormRow label="Beschreibung"><FormattedTextField value={selectedPage.description} rows={3} onChange={value => patchPage({ description: value }, false)} /></FormRow>
              <FormRow label="Button-Beschriftung"><Input value={selectedPage.buttonLabel} onChange={event => patchPage({ buttonLabel: event.target.value }, false)} /></FormRow>
              <div className="grid gap-3 rounded-2xl border p-4">
                <div>
                  <p className="text-sm font-bold">Stufe in der Fortschrittsanzeige</p>
                  <p className="text-xs text-muted-foreground">Öffentlicher Name dieser Seite in der Statusleiste. Leer = interner Seitenname.</p>
                </div>
                <FormRow label="Stufenname"><Input value={selectedPage.progressTitle ?? ""} placeholder={selectedPage.name} onChange={event => patchPage({ progressTitle: event.target.value } as Partial<FunnelPage>, false)} /></FormRow>
                <FormRow label="Kurztext (optional)"><Input value={selectedPage.progressHint ?? ""} placeholder="z. B. Passt der Job zu dir?" onChange={event => patchPage({ progressHint: event.target.value } as Partial<FunnelPage>, false)} /></FormRow>
                <FormRow label="Icon dieser Stufe">
                  <IconPicker
                    value={selectedPage.progressIcon ?? "sparkles"}
                    color={config.brand.accentColor}
                    onChange={icon => patchPage({ progressIcon: icon } as Partial<FunnelPage>)}
                  />
                </FormRow>
              </div>

              {selectedPage.type === "start" && (
                <StartPageFields
                  funnelId={config.id}
                  page={selectedPage}
                  brandColor={config.brand.accentColor}
                  patch={patchPage}
                />
              )}

              {(selectedPage.type === "choice-grid" || selectedPage.type === "choice-list") && <>
                <label className="flex items-center justify-between rounded-xl border p-3"><span><strong className="block text-sm">Mehrfachauswahl</strong><small className="text-muted-foreground">Mehrere Antworten erlauben</small></span><Switch checked={selectedPage.allowMultiple} onCheckedChange={checked => patchPage({ allowMultiple: checked } as Partial<FunnelPage>)} /></label>
                <div className="grid gap-3"><div className="flex items-center justify-between"><Label>Antwortoptionen</Label><Button size="sm" variant="outline" onClick={() => patchPage({ options: [...selectedPage.options, { id: crypto.randomUUID(), label: "Neue Option", value: `option-${selectedPage.options.length + 1}`, icon: "sparkles" }] } as Partial<FunnelPage>)}>Option hinzufügen</Button></div>
                  {selectedPage.options.map((option, optionIndex) => <div className="grid gap-2 rounded-xl border bg-slate-50 p-3" key={option.id}><div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_170px_auto]"><FormattedTextField value={option.label} rows={1} onChange={value => patchPage({ options: selectedPage.options.map(item => item.id === option.id ? { ...item, label: value, value: stripFormattedText(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || item.value } : item) } as Partial<FunnelPage>)} /><IconPicker value={option.icon} onChange={icon => patchPage({ options: selectedPage.options.map(item => item.id === option.id ? { ...item, icon } : item) } as Partial<FunnelPage>)} /><Button size="icon" variant="ghost" className="shrink-0 text-destructive" aria-label={`Option ${stripFormattedText(option.label)} löschen`} disabled={selectedPage.options.length <= 2} onClick={() => patchPage({ options: selectedPage.options.filter((_, index) => index !== optionIndex) } as Partial<FunnelPage>)}><Trash2 className="size-4" /></Button></div><FormattedTextField placeholder="Optionale Kurzbeschreibung" rows={2} value={option.description ?? ""} onChange={value => patchPage({ options: selectedPage.options.map(item => item.id === option.id ? { ...item, description: value } : item) } as Partial<FunnelPage>)} /><FormRow label="Wert für Meta (€)" hint="Leer = kein Extra-Wert. Gute Antworten höher, schwache niedriger. Summe geht mit dem Lead an Meta."><Input inputMode="decimal" placeholder="z. B. 80" value={option.leadValue ?? ""} onChange={event => { const raw = event.target.value.trim().replace(",", "."); const nextValue = raw === "" ? undefined : Number(raw); patchPage({ options: selectedPage.options.map(item => item.id === option.id ? { ...item, leadValue: nextValue !== undefined && Number.isFinite(nextValue) && nextValue >= 0 && nextValue <= 10000 ? Math.round(nextValue * 100) / 100 : undefined } : item) } as Partial<FunnelPage>); }} /></FormRow></div>)}
                </div>
              </>}

              {selectedPage.type === "contact" && <ContactEditor page={selectedPage} patch={patchPage} />}
            </TabsContent>

            <TabsContent value="global" className="mt-0 grid gap-5">
              <label className="flex items-center justify-between rounded-xl border p-3"><span><strong className="block text-sm">Funnel veröffentlicht</strong><small className="text-muted-foreground">Öffentliche URL aktivieren; Ausschalten pausiert einen laufenden Funnel</small></span><Switch checked={config.status === "published"} disabled={config.status === "archived"} onCheckedChange={checked => changeConfig(current => ({ ...current, status: checked ? "published" : current.status === "published" ? "paused" : current.status, isPublished: checked }))} /></label>
              <FormRow label="Funnel-Titel"><Input value={config.title} onChange={event => changeConfig(current => ({ ...current, title: event.target.value }))} /></FormRow>
              <FormRow label="URL-Slug"><Input value={config.slug} onChange={event => changeConfig(current => ({ ...current, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))} /></FormRow>
              <ProgressSettings config={config} changeConfig={changeConfig} />
              <div className="grid gap-4 rounded-2xl border bg-slate-50/70 p-4">
                <div><p className="text-sm font-bold">Logo & Browser-Icon</p><p className="text-xs text-muted-foreground">Diese Angaben gelten nur für diesen Funnel.</p></div>
                <div className="grid gap-3 sm:grid-cols-[96px_minmax(0,1fr)]">
                  <div className="grid h-16 place-items-center overflow-hidden rounded-2xl border bg-white px-2 shadow-sm">{config.brand.logoUrl ? <img className="max-h-12 max-w-full object-contain" src={config.brand.logoUrl} alt={config.brand.logoAlt || "Logo-Vorschau"} /> : <ImageIcon className="size-7 text-slate-400" aria-hidden="true" />}</div>
                  <div className="grid gap-3">
                    <FormRow label="Logo" hint="PNG, JPG oder WebP, maximal 2 MB. Erscheint oben im Funnel.">
                      <div className="flex flex-wrap gap-2">
                        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-white px-3 text-sm font-medium shadow-xs transition hover:bg-slate-100">
                          <UploadCloud className="size-4" />{logoUpload.isPending ? "Wird hochgeladen …" : "Logo hochladen"}
                          <input className="sr-only" type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" disabled={logoUpload.isPending} onChange={event => { void selectLogo(event.target.files?.[0]); event.target.value = ""; }} />
                        </label>
                        {config.brand.logoUrl && <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => changeConfig(current => ({ ...current, brand: { ...current.brand, logoUrl: "" } }))}><X className="size-4" />Entfernen</Button>}
                      </div>
                    </FormRow>
                    <FormRow label="Oder Logo-URL" hint="Optional, wenn das Logo schon unter einer HTTPS-Adresse liegt.">
                      <Input value={config.brand.logoUrl} placeholder="https://…/logo.png" onChange={event => changeConfig(current => ({ ...current, brand: { ...current.brand, logoUrl: event.target.value } }))} />
                    </FormRow>
                  </div>
                </div>
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><BrandColorField label="Hintergrund" value={config.brand.backgroundColor} onChange={value => changeConfig(current => ({ ...current, brand: { ...current.brand, backgroundColor: value } }))} /><BrandColorField label="Textfarbe" value={config.brand.textColor} onChange={value => changeConfig(current => ({ ...current, brand: { ...current.brand, textColor: value } }))} /></div>
              </div>
              <div className="grid gap-4 rounded-2xl border p-4">
                <div><p className="text-sm font-bold">Klickbare Antwortkästen</p><p className="text-xs text-muted-foreground">Normale und ausgewählte Zustände lassen sich getrennt gestalten. In der Vorschau können Sie eine Antwort anklicken.</p></div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><BrandColorField label="Kasten" value={config.brand.choiceBackgroundColor} onChange={value => changeConfig(current => ({ ...current, brand: { ...current.brand, choiceBackgroundColor: value } }))} /><BrandColorField label="Kasten-Text" value={config.brand.choiceTextColor} onChange={value => changeConfig(current => ({ ...current, brand: { ...current.brand, choiceTextColor: value } }))} /><BrandColorField label="Auswahl" value={config.brand.choiceSelectedBackgroundColor} onChange={value => changeConfig(current => ({ ...current, brand: { ...current.brand, choiceSelectedBackgroundColor: value } }))} /><BrandColorField label="Auswahl-Text" value={config.brand.choiceSelectedTextColor} onChange={value => changeConfig(current => ({ ...current, brand: { ...current.brand, choiceSelectedTextColor: value } }))} /><BrandColorField label="Auswahl-Rahmen" value={config.brand.choiceSelectedBorderColor} onChange={value => changeConfig(current => ({ ...current, brand: { ...current.brand, choiceSelectedBorderColor: value } }))} /></div>
              </div>
              <label className="flex items-center justify-between rounded-xl border p-3"><span><strong className="block text-sm">Social Proof anzeigen</strong><small className="text-muted-foreground">Vertrauenshinweis im Footer</small></span><Switch checked={config.socialProof.enabled} onCheckedChange={checked => changeConfig(current => ({ ...current, socialProof: { ...current.socialProof, enabled: checked } }))} /></label>
              <FormRow label="Social-Proof-Überschrift"><FormattedTextField rows={1} value={config.socialProof.eyebrow} onChange={value => changeConfig(current => ({ ...current, socialProof: { ...current.socialProof, eyebrow: value } }))} /></FormRow>
              <FormRow label="Social-Proof-Text"><FormattedTextField rows={3} value={config.socialProof.text} onChange={value => changeConfig(current => ({ ...current, socialProof: { ...current.socialProof, text: value } }))} /></FormRow>
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

function StartPageFields({
  funnelId,
  page,
  brandColor,
  patch,
}: {
  funnelId: string;
  page: StartPage;
  brandColor: string;
  patch: (value: Partial<FunnelPage>, immediate?: boolean) => void;
}) {
  const layout = resolveStartLayout(page);
  const tileLayout = resolveBenefitsTileLayout(page.benefitsTileLayout);
  const addBenefit = () => patch({ benefits: [...page.benefits, emptyStartBenefit()] } as Partial<FunnelPage>);
  return (
    <>
      {layout === "classic" && (
        <>
          <FormRow label="Bild-URL" hint="Leer lassen, um die neutrale Illustration bzw. den reinen Text-Hero zu verwenden.">
            <Input value={page.heroImageUrl} onChange={event => patch({ heroImageUrl: event.target.value } as Partial<FunnelPage>, false)} />
          </FormRow>
          <FormRow label="Vorteile – eine Zeile pro Punkt">
            <Textarea value={page.bullets.join("\n")} rows={4} onChange={event => patch({ bullets: event.target.value.split("\n").filter(Boolean) } as Partial<FunnelPage>, false)} />
          </FormRow>
          <FormRow label="Hinweis unter dem Button">
            <Input value={page.trustNote} onChange={event => patch({ trustNote: event.target.value } as Partial<FunnelPage>, false)} />
          </FormRow>
        </>
      )}

      {layout === "benefits" && (
        <>
          <HeroBackgroundField funnelId={funnelId} page={page} onChange={next => patch(next as Partial<FunnelPage>)} />
          <FormRow label="Bildelement (optional)" hint="Eigenes Foto als Element über der Überschrift, zum Beispiel ein Portrait. Unabhängig vom Hintergrundbild. Leer = kein Bildelement.">
            <Input value={page.heroImageUrl} placeholder="https://…/portrait.jpg" onChange={event => patch({ heroImageUrl: event.target.value } as Partial<FunnelPage>, false)} />
          </FormRow>
          <StartBadgesField
            badges={page.badges ?? []}
            brandColor={brandColor}
            onChange={badges => patch({ badges } as Partial<FunnelPage>)}
          />
          <FormRow label="Trenner-Überschrift" hint="Volle Fläche in der Brandingfarbe, z. B. „Deine Vorteile bei uns“.">
            <FormattedTextField rows={1} value={page.benefitsBandTitle} onChange={value => patch({ benefitsBandTitle: value } as Partial<FunnelPage>, false)} />
          </FormRow>
          <FormRow label="Hinweis unter dem oberen Button">
            <Input value={page.trustNote} onChange={event => patch({ trustNote: event.target.value } as Partial<FunnelPage>, false)} />
          </FormRow>
          <FormRow label="Unterer Button" hint="Leer = gleiche Beschriftung wie der Button oben.">
            <Input value={page.secondaryButtonLabel} placeholder={page.buttonLabel} onChange={event => patch({ secondaryButtonLabel: event.target.value } as Partial<FunnelPage>, false)} />
          </FormRow>
          <BenefitsTileLayoutPicker
            value={tileLayout}
            onChange={benefitsTileLayout => patch({ benefitsTileLayout } as Partial<FunnelPage>)}
          />
          {tileLayout === "two-column" && (
            <BenefitsTileGapPicker
              value={resolveBenefitsTileGap(page.benefitsTileGap)}
              onChange={benefitsTileGap => patch({ benefitsTileGap } as Partial<FunnelPage>)}
            />
          )}
          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <Label>Icon-Kacheln</Label>
              <Button
                size="sm"
                variant="outline"
                disabled={page.benefits.length >= MAX_START_BENEFITS}
                onClick={addBenefit}
              >
                Weiteren Vorteil hinzufügen
              </Button>
            </div>
            {page.benefits.map((benefit, index) => (
              <div className="grid gap-3 rounded-xl border bg-slate-50 p-3" key={benefit.id}>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_170px_auto]">
                  <FormattedTextField rows={1} value={benefit.title} onChange={value => patch({ benefits: page.benefits.map(item => item.id === benefit.id ? { ...item, title: value } : item) } as Partial<FunnelPage>)} />
                  <IconPicker value={benefit.icon} color={benefit.color || brandColor} onChange={icon => patch({ benefits: page.benefits.map(item => item.id === benefit.id ? { ...item, icon } : item) } as Partial<FunnelPage>)} />
                  <Button size="icon" variant="ghost" className="shrink-0 text-destructive" aria-label={`Vorteil ${stripFormattedText(benefit.title)} löschen`} onClick={() => patch({ benefits: page.benefits.filter((_, itemIndex) => itemIndex !== index) } as Partial<FunnelPage>)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <FormattedTextField rows={tileLayout === "one-column" ? 4 : 2} placeholder={tileLayout === "one-column" ? "Längerer Erklärtext" : "Kurzer Erklärtext"} value={benefit.text} onChange={value => patch({ benefits: page.benefits.map(item => item.id === benefit.id ? { ...item, text: value } : item) } as Partial<FunnelPage>)} />
                <IconColorField
                  label="Iconfarbe"
                  value={benefit.color}
                  brandColor={brandColor}
                  onChange={color => patch({ benefits: page.benefits.map(item => item.id === benefit.id ? { ...item, color } : item) } as Partial<FunnelPage>)}
                />
              </div>
            ))}
            {page.benefits.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="justify-center"
                disabled={page.benefits.length >= MAX_START_BENEFITS}
                onClick={addBenefit}
              >
                Weiteren Vorteil hinzufügen
              </Button>
            )}
          </div>
        </>
      )}
    </>
  );
}

function ProgressSettings({
  config,
  changeConfig,
}: {
  config: FunnelConfig;
  changeConfig: (updater: (current: FunnelConfig) => FunnelConfig, immediate?: boolean) => void;
}) {
  const progress = config.progress ?? DEFAULT_PROGRESS;
  const resolved = resolveProgressColors(config.brand, progress.colors);
  const patchProgress = (patch: Partial<FunnelConfig["progress"]>, immediate = true) => {
    changeConfig(current => ({
      ...current,
      progress: {
        layout: resolveProgressLayout(patch.layout ?? current.progress?.layout),
        colors: { ...DEFAULT_PROGRESS.colors, ...(current.progress?.colors ?? {}), ...(patch.colors ?? {}) },
      },
    }), immediate);
  };
  const patchColor = (key: keyof typeof progress.colors, value: string) => {
    patchProgress({ colors: { ...progress.colors, [key]: value } });
  };

  return (
    <div className="grid gap-4 rounded-2xl border p-4">
      <div>
        <p className="text-sm font-bold">Fortschrittsanzeige</p>
        <p className="text-xs text-muted-foreground">Gilt für alle Seiten. Stufentexte änderst du auf der jeweiligen Seite oder hier in der Liste.</p>
      </div>
      <ProgressLayoutPicker value={resolveProgressLayout(progress.layout)} onChange={layout => patchProgress({ layout })} />
      <div className="grid gap-3">
        {config.pages.map((page, index) => (
          <div key={page.id} className={`grid gap-2 rounded-xl border bg-slate-50 p-3 sm:grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_170px] ${isFunnelPageHidden(page) ? "opacity-50 grayscale" : ""}`}>
            <span className="pt-2 text-xs font-bold text-muted-foreground">{isFunnelPageHidden(page) ? "–" : index + 1}</span>
            <Input value={page.progressTitle ?? ""} placeholder={page.name} onChange={event => changeConfig(current => ({ ...current, pages: current.pages.map(item => item.id === page.id ? { ...item, progressTitle: event.target.value } as FunnelPage : item) }), false)} />
            <Input value={page.progressHint ?? ""} placeholder="Kurztext" onChange={event => changeConfig(current => ({ ...current, pages: current.pages.map(item => item.id === page.id ? { ...item, progressHint: event.target.value } as FunnelPage : item) }), false)} />
            <IconPicker value={page.progressIcon ?? "sparkles"} color={config.brand.accentColor} onChange={icon => changeConfig(current => ({ ...current, pages: current.pages.map(item => item.id === page.id ? { ...item, progressIcon: icon } as FunnelPage : item) }))} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <OptionalProgressColor label="Aktive Stufe" value={progress.colors.active} fallback={resolved.active} onChange={value => patchColor("active", value)} />
        <OptionalProgressColor label="Erledigte Stufe" value={progress.colors.completed} fallback={resolved.completed} onChange={value => patchColor("completed", value)} />
        <OptionalProgressColor label="Kommende Stufe" value={progress.colors.upcoming} fallback={resolved.upcoming} onChange={value => patchColor("upcoming", value)} />
        <OptionalProgressColor label="Balken / Linie" value={progress.colors.track} fallback={resolved.track} onChange={value => patchColor("track", value)} />
        <OptionalProgressColor label="Stufentext" value={progress.colors.text} fallback={resolved.text} onChange={value => patchColor("text", value)} />
        <OptionalProgressColor label="Nebentext" value={progress.colors.muted} fallback={resolved.muted} onChange={value => patchColor("muted", value)} />
      </div>
    </div>
  );
}

function OptionalProgressColor({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1">
      <BrandColorField label={label} value={value || fallback} onChange={onChange} hint={value ? "Eigene Farbe für dieses Element." : "Leer = Brandingfarbe."} />
      {value ? <Button type="button" size="sm" variant="ghost" className="justify-start px-0" onClick={() => onChange("")}>Branding verwenden</Button> : null}
    </div>
  );
}

function ContactEditor({ page, patch }: { page: ContactPage; patch: (value: Partial<FunnelPage>) => void }) {
  return <div className="grid gap-4"><Label>Formularfelder</Label>{page.fields.map(field => <div key={field.key} className="grid gap-3 rounded-xl border bg-slate-50 p-3"><div className="flex items-center justify-between gap-3"><strong className="text-sm">{field.key}</strong><div className="flex items-center gap-3"><label className="flex items-center gap-2 text-xs">Aktiv<Switch checked={field.enabled} onCheckedChange={enabled => patch({ fields: page.fields.map(item => item.key === field.key ? { ...item, enabled } : item) } as Partial<FunnelPage>)} /></label><label className="flex items-center gap-2 text-xs">Pflicht<Switch checked={field.required} disabled={!field.enabled} onCheckedChange={required => patch({ fields: page.fields.map(item => item.key === field.key ? { ...item, required } : item) } as Partial<FunnelPage>)} /></label></div></div><Input value={field.label} onChange={event => patch({ fields: page.fields.map(item => item.key === field.key ? { ...item, label: event.target.value } : item) } as Partial<FunnelPage>)} /><Input value={field.placeholder} onChange={event => patch({ fields: page.fields.map(item => item.key === field.key ? { ...item, placeholder: event.target.value } : item) } as Partial<FunnelPage>)} /></div>)}<FormRow label="Datenschutz-Einwilligung"><FormattedTextField rows={3} value={page.consentLabel} onChange={value => patch({ consentLabel: value } as Partial<FunnelPage>)} /></FormRow><label className="flex items-center justify-between rounded-xl border p-3"><span><strong className="block text-sm">Lebenslauf-Upload</strong><small className="text-muted-foreground">PDF, DOC und DOCX</small></span><Switch checked={page.resumeEnabled} onCheckedChange={resumeEnabled => patch({ resumeEnabled } as Partial<FunnelPage>)} /></label>{page.resumeEnabled && <label className="flex items-center justify-between rounded-xl border p-3"><span className="text-sm font-semibold">Upload als Pflichtfeld</span><Switch checked={page.resumeRequired} onCheckedChange={resumeRequired => patch({ resumeRequired } as Partial<FunnelPage>)} /></label>}<FormRow label="Erfolgsüberschrift"><FormattedTextField rows={1} value={page.successTitle} onChange={value => patch({ successTitle: value } as Partial<FunnelPage>)} /></FormRow><FormRow label="Erfolgstext"><FormattedTextField rows={3} value={page.successText} onChange={value => patch({ successText: value } as Partial<FunnelPage>)} /></FormRow></div>;
}
