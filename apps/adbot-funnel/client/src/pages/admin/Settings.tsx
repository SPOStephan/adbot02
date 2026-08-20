import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, CheckCircle2, CircleAlert, Clipboard, ExternalLink, Globe, KeyRound, Loader2, Save, Settings2, Signpost, Target } from "lucide-react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import type { FunnelConfig, FunnelStatus } from "@shared/funnel";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const statusLabels: Record<FunnelStatus, string> = { draft: "Entwurf", published: "Veröffentlicht", paused: "Pausiert", archived: "Archiviert" };

export default function Settings() {
  const { id: funnelId } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const query = trpc.funnel.adminConfig.useQuery(funnelId ? { id: funnelId } : undefined, { enabled: Boolean(funnelId) });
  const [draft, setDraft] = useState<FunnelConfig>();
  const [savedConfig, setSavedConfig] = useState<FunnelConfig>();
  const [copied, setCopied] = useState<"url" | "embed">();
  const [metaAccessToken, setMetaAccessToken] = useState("");
  const [metaTestEventCode, setMetaTestEventCode] = useState("");
  const [savedMetaTestEventCode, setSavedMetaTestEventCode] = useState("");
  const [clearMetaAccessToken, setClearMetaAccessToken] = useState(false);
  const [customHostname, setCustomHostname] = useState("");

  useEffect(() => { if (query.data?.config) { setDraft(query.data.config); setSavedConfig(query.data.config); } }, [query.data?.config]);
  useEffect(() => {
    if (!query.data?.metaServerSettings) return;
    setMetaTestEventCode(query.data.metaServerSettings.testEventCode);
    setSavedMetaTestEventCode(query.data.metaServerSettings.testEventCode);
    setMetaAccessToken("");
    setClearMetaAccessToken(false);
  }, [query.data?.metaServerSettings]);

  const save = trpc.funnel.saveConfig.useMutation({
    onSuccess: async saved => {
      setDraft(saved);
      setSavedConfig(saved);
      await Promise.all([utils.funnel.adminConfig.invalidate({ id: saved.id }), utils.funnel.funnels.invalidate()]);
      toast.success("Einstellungen gespeichert");
    },
    onError: error => toast.error(error.message),
  });
  const saveMetaServer = trpc.funnel.saveMetaServerSettings.useMutation({
    onSuccess: async saved => {
      setMetaAccessToken("");
      setClearMetaAccessToken(false);
      setMetaTestEventCode(saved.testEventCode);
      setSavedMetaTestEventCode(saved.testEventCode);
      await utils.funnel.adminConfig.invalidate({ id: funnelId });
    },
    onError: error => toast.error(error.message),
  });
  const customDomainsQuery = trpc.funnel.customDomains.useQuery(
    { funnelId: funnelId! },
    { enabled: Boolean(funnelId) }
  );
  const registerCustomDomain = trpc.funnel.registerCustomDomain.useMutation({
    onSuccess: async () => {
      setCustomHostname("");
      await customDomainsQuery.refetch();
      toast.success("Custom Domain registriert — bitte nur noch CNAME setzen");
    },
    onError: error => toast.error(error.message),
  });
  const markCustomDomainReady = trpc.funnel.markCustomDomainReady.useMutation({
    onSuccess: async () => {
      await customDomainsQuery.refetch();
      toast.success("Domain aktiv — Funnel unter https://Hostname/ erreichbar");
    },
    onError: error => toast.error(error.message),
  });
  const verifyCustomDomainDns = trpc.funnel.verifyCustomDomainDns.useMutation({
    onSuccess: result => {
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    },
    onError: error => toast.error(error.message),
  });
  const revokeCustomDomain = trpc.funnel.revokeCustomDomain.useMutation({
    onSuccess: async () => {
      await customDomainsQuery.refetch();
      toast.success("Custom Domain zurückgezogen");
    },
    onError: error => toast.error(error.message),
  });
  const readyCustomHost = (customDomainsQuery.data ?? []).find(domain => domain.status === "READY");
  const directUrl = useMemo(() => `${window.location.origin}/f/${draft?.slug ?? "karriere"}`, [draft?.slug]);
  const customPublicUrl = readyCustomHost ? `https://${readyCustomHost.hostname}/` : null;
  const dirty = Boolean(draft && savedConfig && JSON.stringify(draft) !== JSON.stringify(savedConfig));
  const imprintValid = Boolean(draft?.legal.imprintTitle.trim() && draft?.legal.imprintContent.trim());
  const metaServerDirty = Boolean(metaAccessToken.trim() || clearMetaAccessToken || metaTestEventCode !== savedMetaTestEventCode);
  const embedCode = useMemo(() => `<iframe id="recruiting-funnel" src="${directUrl}" title="Karriere-Bewerbung" loading="lazy" style="width:100%;min-height:780px;border:0;border-radius:16px" allow="clipboard-write"></iframe>\n<script>\nwindow.addEventListener("message",function(event){\n  if(event.origin!==new URL("${directUrl}").origin)return;\n  if(event.data?.type!=="social-recruiting-funnel:resize")return;\n  document.getElementById("recruiting-funnel").style.height=event.data.height+"px";\n});\n</script>`, [directUrl]);

  const copy = async (value: string, key: "url" | "embed") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(undefined), 1800);
      toast.success("In die Zwischenablage kopiert");
    } catch {
      toast.error("Kopieren ist in diesem Browser nicht möglich.");
    }
  };

  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty]);

  const navigateSafely = (path: string) => {
    if ((dirty || metaServerDirty) && !window.confirm("Ungespeicherte Einstellungen verwerfen?")) return;
    setLocation(path);
  };

  const persistSettings = async () => {
    if (!draft) return;
    if (!draft.legal.imprintTitle.trim() || !draft.legal.imprintContent.trim()) {
      toast.error("Bitte fülle Impressumsüberschrift und Impressumsinhalt vollständig aus.");
      return;
    }
    try {
      if (dirty) await save.mutateAsync({ ...draft, isPublished: draft.status === "published" });
      if (metaServerDirty) await saveMetaServer.mutateAsync({
        funnelId: draft.id,
        ...(metaAccessToken.trim() ? { accessToken: metaAccessToken.trim() } : {}),
        clearAccessToken: clearMetaAccessToken,
        testEventCode: metaTestEventCode,
      });
      toast.success("Einstellungen gespeichert");
    } catch {
      // Die Mutationen zeigen die konkrete Fehlermeldung bereits an.
    }
  };

  if (!funnelId) return <ErrorState message="Keine Funnel-ID angegeben." onBack={() => setLocation("/admin")} />;
  if (query.error) return <ErrorState message={query.error.message} onBack={() => setLocation("/admin")} />;
  if (query.isLoading || !draft || !query.data) return <div className="grid min-h-[60vh] place-items-center" role="status" aria-live="polite"><span className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="animate-spin text-[#0165c3]" aria-hidden="true" />Einstellungen werden geladen …</span></div>;

  const setPublished = (published: boolean) => setDraft(current => current ? {
    ...current,
    status: published ? "published" : current.status === "published" ? "paused" : current.status,
    isPublished: published,
  } : current);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-2 sm:p-4">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><Button variant="ghost" className="-ml-3 mb-2" onClick={() => navigateSafely("/admin")}><ArrowLeft className="size-4" />Funnel-Bibliothek</Button><p className="text-xs font-bold uppercase tracking-[.15em] text-[#0165c3]">Konfiguration · {statusLabels[draft.status]}</p><h1 className="mt-1 text-3xl font-bold tracking-tight">{draft.title}</h1><p className="mt-2 text-sm text-muted-foreground">Veröffentlichung, Benachrichtigungen und optionale WordPress-Einbettung verwalten.</p>{dirty && <p className="mt-2 text-xs font-semibold text-amber-700" role="status">Ungespeicherte Änderungen</p>}</div><Button variant="outline" onClick={() => navigateSafely(`/admin/funnels/${draft.id}/editor`)}>Zum visuellen Editor</Button></header>

      <div className="grid gap-3 sm:grid-cols-2">
        <SystemState ok={query.data.persistentStoreConfigured} title="Datenbank" okText="Supabase-Persistenz aktiv" missingText="Noch im flüchtigen Speichermodus" />
        <SystemState ok={query.data.emailConfigured} title="E-Mail-Versand" okText="Resend-Absender konfiguriert" missingText="API-Schlüssel oder Absender fehlt" />
      </div>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-[#0165c3]" aria-hidden="true"><Settings2 className="size-5" /></span><div><h2 className="font-bold">Funnel-Grundeinstellungen</h2><p className="text-xs text-muted-foreground">Titel, URL und technische Zustellung dieses Funnels.</p></div></div>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="funnel-title">Funnel-Titel</Label><Input id="funnel-title" maxLength={240} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor="funnel-slug">URL-Slug</Label><Input id="funnel-slug" value={draft.slug} onChange={event => setDraft({ ...draft, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} /><p className="text-xs text-muted-foreground">Muss über alle Funnel hinweg eindeutig sein.</p></div>
          <div className="space-y-2"><Label htmlFor="notification-email">Empfänger-E-Mail</Label><Input id="notification-email" type="email" value={draft.notificationEmail} placeholder="recruiting@unternehmen.de" onChange={event => setDraft({ ...draft, notificationEmail: event.target.value })} /><p className="text-xs text-muted-foreground">An diese Adresse werden neue Bewerbungen dieses Funnels gemeldet.</p></div>
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="privacy-url">Datenschutz-URL</Label><Input id="privacy-url" type="url" value={draft.privacyUrl} onChange={event => setDraft({ ...draft, privacyUrl: event.target.value })} /></div>
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="imprint-title">Impressum – Überschrift <span className="text-destructive" aria-hidden="true">*</span></Label><Input id="imprint-title" required aria-required="true" aria-invalid={!draft.legal.imprintTitle.trim()} maxLength={160} value={draft.legal.imprintTitle} onChange={event => setDraft({ ...draft, legal: { ...draft.legal, imprintTitle: event.target.value } })} /></div>
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="imprint-content">Impressum – Inhalt <span className="text-destructive" aria-hidden="true">*</span></Label><Textarea id="imprint-content" required aria-required="true" aria-invalid={!draft.legal.imprintContent.trim()} aria-describedby="imprint-content-help" rows={10} maxLength={20_000} value={draft.legal.imprintContent} placeholder="Vollständige Anbieterangaben, Vertretungsberechtigte, Kontakt und gegebenenfalls Register- und Steuerangaben" onChange={event => setDraft({ ...draft, legal: { ...draft.legal, imprintContent: event.target.value } })} /><p id="imprint-content-help" className="text-xs text-muted-foreground">Pflichtangabe. Wird als reiner Text sicher unter <code>/f/{draft.slug}/impressum</code> ausgegeben. Absätze und Zeilenumbrüche bleiben erhalten.</p></div>
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="origins">Erlaubte Einbettungs-Domains <span className="font-normal text-muted-foreground">(optional)</span></Label><Textarea id="origins" rows={3} value={draft.allowedEmbedOrigins.join("\n")} placeholder="Nur bei Bedarf, z. B. https://www.unternehmen.de" onChange={event => setDraft({ ...draft, allowedEmbedOrigins: event.target.value.split("\n").map(value => value.trim()).filter(Boolean) })} /><p className="text-xs text-muted-foreground">Eine vollständige Domain pro Zeile inklusive https://.</p></div>
          <div className="flex items-center justify-between rounded-xl border p-4 sm:col-span-2"><div><Label htmlFor="published">Funnel veröffentlicht</Label><p className="mt-1 text-xs text-muted-foreground">Ausschalten pausiert einen bereits veröffentlichten Funnel. Archivierte Funnel stellst du in der Bibliothek wieder her.</p></div><Switch id="published" checked={draft.status === "published"} disabled={draft.status === "archived"} onCheckedChange={setPublished} /></div>
        </div>
        {save.error && <p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{save.error.message}</p>}
        <div className="mt-6 flex justify-end"><Button className="bg-[#0165c3] hover:bg-[#0154a3]" disabled={save.isPending || saveMetaServer.isPending || !draft.title.trim() || !imprintValid || (!dirty && !metaServerDirty)} aria-busy={save.isPending || saveMetaServer.isPending} onClick={persistSettings}>{save.isPending || saveMetaServer.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}{save.isPending || saveMetaServer.isPending ? "Wird gespeichert …" : "Einstellungen speichern"}</Button></div>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-[#0165c3]" aria-hidden="true"><Signpost className="size-5" /></span><div><h2 className="font-bold">Nach erfolgreicher Bewerbung</h2><p className="text-xs text-muted-foreground">Erfolgsnachricht anzeigen oder nach bestätigter Speicherung sicher weiterleiten.</p></div></div>
        <div className="mt-6 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Verhalten nach dem Absenden">
            <button type="button" role="radio" aria-checked={draft.postSubmit.mode === "message"} className={`rounded-xl border p-4 text-left transition ${draft.postSubmit.mode === "message" ? "border-[#0165c3] bg-blue-50 ring-1 ring-[#0165c3]" : "hover:border-slate-300"}`} onClick={() => setDraft({ ...draft, postSubmit: { ...draft.postSubmit, mode: "message" } })}><strong className="block text-sm">Erfolgsnachricht</strong><span className="mt-1 block text-xs text-muted-foreground">Zeigt den im visuellen Editor gepflegten Titel und Text.</span></button>
            <button type="button" role="radio" aria-checked={draft.postSubmit.mode === "redirect"} className={`rounded-xl border p-4 text-left transition ${draft.postSubmit.mode === "redirect" ? "border-[#0165c3] bg-blue-50 ring-1 ring-[#0165c3]" : "hover:border-slate-300"}`} onClick={() => setDraft({ ...draft, postSubmit: { ...draft.postSubmit, mode: "redirect" } })}><strong className="block text-sm">Weiterleitung</strong><span className="mt-1 block text-xs text-muted-foreground">Öffnet erst nach erfolgreicher Bewerbung eine externe HTTPS-Adresse.</span></button>
          </div>
          {draft.postSubmit.mode === "redirect" && <div className="space-y-2"><Label htmlFor="redirect-url">Weiterleitungs-URL</Label><Input id="redirect-url" type="url" inputMode="url" placeholder="https://www.unternehmen.de/vielen-dank" value={draft.postSubmit.redirectUrl} onChange={event => setDraft({ ...draft, postSubmit: { ...draft.postSubmit, redirectUrl: event.target.value.trim() } })} /><p className="text-xs text-muted-foreground">Nur absolute HTTPS-Adressen werden gespeichert. Bei einem Fehler bleibt die Bewerbung trotzdem erhalten.</p></div>}
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-[#0165c3]" aria-hidden="true"><Target className="size-5" /></span><div><h2 className="font-bold">Meta Conversion Tracking</h2><p className="text-xs text-muted-foreground">Browser-Pixel und optional serverseitige Conversions API pro Funnel konfigurieren.</p></div></div>
        <div className="mt-6 space-y-5">
          <div className="flex items-center justify-between gap-4 rounded-xl border p-4"><div><Label htmlFor="meta-enabled">Meta-Tracking aktiv</Label><p className="mt-1 text-xs leading-5 text-muted-foreground">Lädt den Browser-Pixel automatisch und meldet Conversions gemäß dem gewählten Zeitpunkt. Mit hinterlegtem Token wird dasselbe Ereignis zusätzlich serverseitig gesendet.</p></div><Switch id="meta-enabled" checked={draft.metaTracking.enabled} onCheckedChange={enabled => setDraft({ ...draft, metaTracking: { ...draft.metaTracking, enabled } })} /></div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="meta-pixel-id">Meta Pixel-ID</Label><Input id="meta-pixel-id" inputMode="numeric" placeholder="123456789012345" value={draft.metaTracking.pixelId} onChange={event => setDraft({ ...draft, metaTracking: { ...draft.metaTracking, pixelId: event.target.value.replace(/\D/g, "").slice(0, 25) } })} /><p className="text-xs text-muted-foreground">Nur Ziffern; gilt für Browser-Pixel und Conversions API. Wird automatisch aus dem Adbot-Portal übernommen, wenn das Feld leer ist.</p></div>
            <div className="space-y-2"><Label htmlFor="meta-event-name">Conversion-Event</Label><Input id="meta-event-name" value={draft.metaTracking.eventName} onChange={event => setDraft({ ...draft, metaTracking: { ...draft.metaTracking, eventName: event.target.value.replace(/[^A-Za-z0-9_]/g, "") } })} /><p className="text-xs text-muted-foreground">Empfohlenes Standardereignis für Bewerbungen: <code>Lead</code>.</p></div>
          </div>
          <div className="space-y-3">
            <Label>Conversion-Zeitpunkt</Label>
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Meta-Conversion-Zeitpunkt">
              <button type="button" role="radio" aria-checked={draft.metaTracking.conversionTrigger === "submit"} className={`rounded-xl border p-4 text-left transition ${draft.metaTracking.conversionTrigger === "submit" ? "border-[#0165c3] bg-blue-50 ring-1 ring-[#0165c3]" : "hover:border-slate-300"}`} onClick={() => setDraft({ ...draft, metaTracking: { ...draft.metaTracking, conversionTrigger: "submit" } })}><strong className="block text-sm">Beim Absenden</strong><span className="mt-1 block text-xs text-muted-foreground">Standard: Pixel und CAPI melden die Conversion direkt nach erfolgreicher Speicherung.</span></button>
              <button type="button" role="radio" aria-checked={draft.metaTracking.conversionTrigger === "doi"} className={`rounded-xl border p-4 text-left transition ${draft.metaTracking.conversionTrigger === "doi" ? "border-[#0165c3] bg-blue-50 ring-1 ring-[#0165c3]" : "hover:border-slate-300"}`} onClick={() => setDraft({ ...draft, metaTracking: { ...draft.metaTracking, conversionTrigger: "doi" } })}><strong className="block text-sm">Nach DOI</strong><span className="mt-1 block text-xs text-muted-foreground">Beim Absenden wird keine Conversion gesendet; die Meldung erfolgt erst nach Double-Opt-In (DOI-Versand folgt).</span></button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-start gap-3"><KeyRound className="mt-0.5 size-5 shrink-0 text-[#0165c3]" aria-hidden="true" /><div><h3 className="text-sm font-bold">Conversions API – serverseitig</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Für Lead-Kampagnen mit Meta-Optimierung empfohlen. Ohne Token arbeitet der Funnel im Browser-only-Modus (Adblocker können Events schlucken). Mit Token wird dieselbe Conversion zusätzlich serverseitig mit gemeinsamer Event-ID gemeldet; kurze Netzfehler werden begrenzt wiederholt. DOI-Trigger sendet beim Absenden noch kein Event.</p></div></div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="meta-access-token">Zugangstoken</Label><Input id="meta-access-token" type="password" autoComplete="new-password" placeholder={query.data.metaServerSettings.hasAccessToken && !clearMetaAccessToken ? "Verschlüsseltes Token gespeichert – nur zum Ersetzen neu einfügen" : "Meta Conversions API Access Token"} value={metaAccessToken} onChange={event => { setMetaAccessToken(event.target.value); setClearMetaAccessToken(false); }} /><p className="text-xs text-muted-foreground">Das Token wird AES-256-GCM-verschlüsselt gespeichert, nie an Besucher ausgeliefert und hier nicht wieder angezeigt.</p></div>
              <div className="space-y-2"><Label htmlFor="meta-test-code">Test-Event-Code <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="meta-test-code" placeholder="TEST12345" value={metaTestEventCode} onChange={event => setMetaTestEventCode(event.target.value.slice(0, 160))} /><p className="text-xs text-muted-foreground">Nur für „Test Events“ im Meta Events Manager; vor Produktivbetrieb leeren.</p></div>
              <div className="flex items-end"><Button type="button" variant={clearMetaAccessToken ? "destructive" : "outline"} disabled={!query.data.metaServerSettings.hasAccessToken && !metaAccessToken} onClick={() => { setMetaAccessToken(""); setClearMetaAccessToken(current => !current); }}>{clearMetaAccessToken ? "Entfernen vorgemerkt" : "Gespeichertes Token entfernen"}</Button></div>
            </div>
          </div>
          <div className="flex justify-end"><Button className="bg-[#0165c3] hover:bg-[#0154a3]" disabled={save.isPending || saveMetaServer.isPending || (!dirty && !metaServerDirty)} aria-busy={save.isPending || saveMetaServer.isPending} onClick={persistSettings}>{save.isPending || saveMetaServer.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}{save.isPending || saveMetaServer.isPending ? "Wird gespeichert …" : "Tracking-Einstellungen speichern"}</Button></div>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-[#0165c3]" aria-hidden="true"><Globe className="size-5" /></span><div><h2 className="font-bold">Custom Domain</h2><p className="text-xs text-muted-foreground">Subdomain deines Unternehmens per CNAME auf Adbot zeigen. Beim Registrieren hinterlegen wir die Domain automatisch am Funnel-Hosting (SSL). Danach DNS prüfen — Root-URL zeigt diesen Funnel. Shared-Host `/f/…` bleibt parallel.</p></div></div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Input
            aria-label="Custom Hostname"
            placeholder="karriere.dein-unternehmen.de"
            value={customHostname}
            onChange={event => setCustomHostname(event.target.value.toLowerCase())}
          />
          <Button
            className="bg-[#0165c3] hover:bg-[#0154a3]"
            disabled={!funnelId || !customHostname.trim() || registerCustomDomain.isPending}
            onClick={() =>
              funnelId &&
              registerCustomDomain.mutate({
                funnelId,
                hostname: customHostname.trim(),
              })
            }
          >
            {registerCustomDomain.isPending ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}
            Domain registrieren
          </Button>
        </div>
        <ul className="mt-5 space-y-3">
          {(customDomainsQuery.data ?? []).map(domain => (
            <li className="rounded-xl border p-4" key={domain.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold">{domain.hostname}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Status {domain.status} · CNAME → <code>{domain.dnsTarget}</code>
                  </p>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    1) CNAME <code>{domain.hostname}</code> → <code>{domain.dnsTarget}</code>{" "}
                    2) „DNS prüfen & aktivieren“. Öffentliche URL danach:{" "}
                    <code>https://{domain.hostname}/</code>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {domain.status === "PENDING_DNS" ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={verifyCustomDomainDns.isPending}
                        onClick={() =>
                          funnelId &&
                          verifyCustomDomainDns.mutate({
                            funnelId,
                            domainId: domain.id,
                          })
                        }
                      >
                        {verifyCustomDomainDns.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                        Nur DNS prüfen
                      </Button>
                      <Button
                        size="sm"
                        className="bg-[#0165c3] hover:bg-[#0154a3]"
                        disabled={markCustomDomainReady.isPending}
                        onClick={() =>
                          funnelId &&
                          markCustomDomainReady.mutate({
                            funnelId,
                            domainId: domain.id,
                          })
                        }
                      >
                        {markCustomDomainReady.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                        DNS prüfen & aktivieren
                      </Button>
                    </>
                  ) : null}
                  {domain.status === "READY" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(`https://${domain.hostname}/`, "_blank", "noopener,noreferrer")}
                    >
                      <ExternalLink className="size-4" />
                      Öffnen
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={revokeCustomDomain.isPending}
                    onClick={() =>
                      funnelId &&
                      revokeCustomDomain.mutate({
                        funnelId,
                        domainId: domain.id,
                      })
                    }
                  >
                    Zurückziehen
                  </Button>
                </div>
              </div>
            </li>
          ))}
          {(customDomainsQuery.data?.length ?? 0) === 0 ? (
            <li className="text-sm text-muted-foreground">Noch keine Custom Domain registriert. Der Shared-Host-Pfad `/f/…` bleibt unverändert nutzbar.</li>
          ) : null}
        </ul>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <h2 className="font-bold">Direktlink und optionale WordPress-Einbettung</h2><p className="mt-1 text-sm text-muted-foreground">Der Funnel funktioniert vollständig über die eigenständige URL; die Einbettung ist nur eine zusätzliche Möglichkeit.</p>
        <div className="mt-5 space-y-2"><Label htmlFor="public-funnel-url">Öffentliche Funnel-URL (Shared Host)</Label><div className="flex gap-2"><Input id="public-funnel-url" readOnly value={directUrl} /><Button variant="outline" size="icon" aria-label="URL kopieren" onClick={() => copy(directUrl, "url")}>{copied === "url" ? <Check className="size-4" aria-hidden="true" /> : <Clipboard className="size-4" aria-hidden="true" />}</Button><Button variant="outline" size="icon" aria-label="Funnel öffnen" disabled={draft.status !== "published"} onClick={() => window.open(directUrl, "_blank", "noopener,noreferrer")}><ExternalLink className="size-4" aria-hidden="true" /></Button></div>{draft.status !== "published" && <p className="text-xs text-amber-700">Die URL wird erst nach der Veröffentlichung erreichbar.</p>}</div>
        {customPublicUrl ? (
          <div className="mt-5 space-y-2">
            <Label htmlFor="custom-funnel-url">Custom Domain URL</Label>
            <div className="flex gap-2">
              <Input id="custom-funnel-url" readOnly value={customPublicUrl} />
              <Button variant="outline" size="icon" aria-label="Custom-URL kopieren" onClick={() => copy(customPublicUrl, "url")}>
                {copied === "url" ? <Check className="size-4" aria-hidden="true" /> : <Clipboard className="size-4" aria-hidden="true" />}
              </Button>
              <Button variant="outline" size="icon" aria-label="Custom Domain öffnen" disabled={draft.status !== "published"} onClick={() => window.open(customPublicUrl, "_blank", "noopener,noreferrer")}>
                <ExternalLink className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ) : null}
        <div className="mt-5 space-y-2"><div className="flex items-center justify-between"><Label>Einbettungscode</Label><Button variant="ghost" size="sm" onClick={() => copy(embedCode, "embed")}>{copied === "embed" ? <Check className="size-4" /> : <Clipboard className="size-4" />}Kopieren</Button></div><pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-100"><code>{embedCode}</code></pre><p className="text-xs text-muted-foreground">In WordPress in einen Block „Individuelles HTML“ einfügen. Die Höhe wird automatisch angepasst.</p></div>
      </section>
    </div>
  );
}

function ErrorState({ message, onBack }: { message: string; onBack: () => void }) {
  return <div className="grid min-h-[60vh] place-items-center p-8 text-center" role="alert"><div><CircleAlert className="mx-auto size-8 text-destructive" /><p className="mt-3 font-semibold text-destructive">{message}</p><Button className="mt-4" variant="outline" onClick={onBack}>Zur Funnel-Bibliothek</Button></div></div>;
}

function SystemState({ ok, title, okText, missingText }: { ok: boolean; title: string; okText: string; missingText: string }) {
  return <div className={`flex items-start gap-3 rounded-2xl border p-4 ${ok ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60"}`}>{ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden="true" /> : <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />}<div><strong className="block text-sm">{title}</strong><span className="mt-1 block text-xs text-muted-foreground">{ok ? okText : missingText}</span></div></div>;
}
