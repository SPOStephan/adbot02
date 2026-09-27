import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { ArrowLeft, Check, CheckCircle2, CircleAlert, Clipboard, ExternalLink, Globe, KeyRound, Loader2, Save, Settings2, Signpost, Target } from "lucide-react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import type { FunnelConfig, FunnelStatus } from "@shared/funnel";
import { FUNNEL_PURPOSE_OPTIONS, funnelPurposeOption, funnelSubmissionPlural, type FunnelPurpose } from "@shared/funnelPurpose";
import { legalPagesAreValid } from "@shared/legalPages";
import { LegalPagesFields } from "@/components/admin/LegalPagesFields";
import { SETTINGS_QUERY_OPTIONS, shouldHydrateSettingsFromQuery } from "@/lib/settingsHydration";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const statusLabels: Record<FunnelStatus, string> = { draft: "Entwurf", published: "Veröffentlicht", paused: "Pausiert", archived: "Archiviert" };

type DomainNotice = { tone: "success" | "warning" | "error"; text: string };

function DomainActionNotice({ notice }: { notice?: DomainNotice }) {
  if (!notice) return null;
  const toneClass =
    notice.tone === "error"
      ? "border-rose-200 bg-rose-50 text-rose-900"
      : notice.tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : "border-emerald-200 bg-emerald-50 text-emerald-950";
  return (
    <p
      className={`domain-action-notice mt-3 rounded-xl border px-3 py-2 text-sm leading-5 ${toneClass}`}
      role={notice.tone === "error" ? "alert" : "status"}
    >
      {notice.text}
    </p>
  );
}

function ChromeWildcardHostNotice() {
  return (
    <div className="chrome-wildcard-host-notice mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-5 text-amber-950" role="note">
      <p className="font-bold">Chrome und Wildcard-DNS beim Hoster</p>
      <p className="mt-1">
        Steht bei All-Inkl, Strato oder IONOS ein CNAME <code>*</code> auf den Webspace, kann Chrome
        eine <strong>brandneue</strong> Subdomain trotzdem dort öffnen — besonders beim ersten
        Aufruf, bevor der eigene CNAME überall ankommt. Dann erscheint das Hoster-Zertifikat
        (<code>*.kasserver.com</code>) oder eine Weiterleitungsschleife. Die Subdomain muss vorher
        keine Website gewesen sein.
      </p>
      <p className="mt-2">
        Die Adresse erst öffnen, wenn „DNS prüfen“ hier grün ist. Nicht auf „unsichere Seite weiter“
        klicken. Safari, Smartphone oder Chrome-Gastfenster prüfen die echte Route. Das <code>*</code>
        für den Rest der Domain kann bleiben; die eigene Zeile (z. B. <code>funnel</code> → Vercel)
        muss stehen.
      </p>
    </div>
  );
}

export default function Settings() {
  const { id: funnelId } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const query = trpc.funnel.adminConfig.useQuery(
    funnelId ? { id: funnelId } : undefined,
    { enabled: Boolean(funnelId), ...SETTINGS_QUERY_OPTIONS },
  );
  const [draft, setDraftState] = useState<FunnelConfig>();
  const [savedConfig, setSavedConfig] = useState<FunnelConfig>();
  const hasLocalDraftChanges = useRef(false);
  const setDraft = useCallback((next: SetStateAction<FunnelConfig | undefined>) => {
    hasLocalDraftChanges.current = true;
    setDraftState(next);
  }, []);
  const dirty = Boolean(draft && savedConfig && JSON.stringify(draft) !== JSON.stringify(savedConfig));
  const [copied, setCopied] = useState<"url" | "embed">();
  const [metaTestEventCode, setMetaTestEventCode] = useState("");
  const [savedMetaTestEventCode, setSavedMetaTestEventCode] = useState("");
  const [customHostname, setCustomHostname] = useState("");
  const [accountHostname, setAccountHostname] = useState("");
  const [accountSectionNotice, setAccountSectionNotice] = useState<DomainNotice>();
  const [customSectionNotice, setCustomSectionNotice] = useState<DomainNotice>();
  const [accountNotices, setAccountNotices] = useState<Record<string, DomainNotice>>({});
  const [customNotices, setCustomNotices] = useState<Record<string, DomainNotice>>({});

  useEffect(() => {
    if (!query.data?.config || !shouldHydrateSettingsFromQuery({
      fetchedAfterMount: query.isFetchedAfterMount,
      hasLocalChanges: hasLocalDraftChanges.current || dirty,
    })) return;
    setDraftState(query.data.config);
    setSavedConfig(query.data.config);
  }, [dirty, query.data?.config, query.isFetchedAfterMount]);
  useEffect(() => {
    if (!query.data?.metaServerSettings) return;
    setMetaTestEventCode(query.data.metaServerSettings.testEventCode);
    setSavedMetaTestEventCode(query.data.metaServerSettings.testEventCode);
  }, [query.data?.metaServerSettings]);

  const save = trpc.funnel.saveConfig.useMutation({
    onSuccess: async saved => {
      utils.funnel.adminConfig.setData({ id: saved.id }, current =>
        current ? { ...current, config: saved } : current,
      );
      hasLocalDraftChanges.current = false;
      setDraftState(saved);
      setSavedConfig(saved);
      await Promise.all([utils.funnel.adminConfig.invalidate({ id: saved.id }), utils.funnel.funnels.invalidate()]);
      toast.success("Einstellungen gespeichert");
    },
    onError: error => toast.error(error.message),
  });
  const saveMetaServer = trpc.funnel.saveMetaServerSettings.useMutation({
    onSuccess: async saved => {
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
  const portalDomainsQuery = trpc.funnel.portalDomains.useQuery(undefined, {
    enabled: Boolean(funnelId),
  });
  const registerCustomDomain = trpc.funnel.registerCustomDomain.useMutation({
    onSuccess: async (domain) => {
      setCustomHostname("");
      await customDomainsQuery.refetch();
      await portalDomainsQuery.refetch();
      setCustomSectionNotice({
        tone: "success",
        text: `${domain.hostname} angebunden. CNAME auf ${domain.dnsTarget} setzen, dann DNS prüfen.`,
      });
    },
    onError: error => setCustomSectionNotice({ tone: "error", text: error.message }),
  });
  const bindPortalDomain = trpc.funnel.bindPortalDomain.useMutation({
    onSuccess: async (domain) => {
      await customDomainsQuery.refetch();
      await portalDomainsQuery.refetch();
      setCustomSectionNotice({
        tone: "success",
        text: `${domain.hostname} an diesen Funnel gebunden.`,
      });
    },
    onError: error => setCustomSectionNotice({ tone: "error", text: error.message }),
  });
  const markCustomDomainReady = trpc.funnel.markCustomDomainReady.useMutation({
    onSuccess: async (domain) => {
      await customDomainsQuery.refetch();
      await portalDomainsQuery.refetch();
      setCustomNotices(current => ({
        ...current,
        [domain.id]: {
          tone: "warning",
          text:
            "httpsMessage" in domain && typeof domain.httpsMessage === "string" && domain.httpsMessage
              ? domain.httpsMessage
              : `Aktiv. Funnel unter https://${domain.hostname}/. Chrome-Hinweis unten beachten — nicht auf unsichere Seite klicken.`,
        },
      }));
    },
    onError: (error, input) => {
      setCustomNotices(current => ({
        ...current,
        [input.domainId]: { tone: "error", text: error.message },
      }));
    },
  });
  const verifyCustomDomainDns = trpc.funnel.verifyCustomDomainDns.useMutation({
    onSuccess: (result, input) => {
      setCustomNotices(current => ({
        ...current,
        [input.domainId]: {
          tone: result.ok ? (result.warning ? "warning" : "success") : "error",
          text: result.message,
        },
      }));
    },
    onError: error => setCustomSectionNotice({ tone: "error", text: error.message }),
  });
  const revokeCustomDomain = trpc.funnel.revokeCustomDomain.useMutation({
    onSuccess: async (domain) => {
      await customDomainsQuery.refetch();
      await portalDomainsQuery.refetch();
      setCustomNotices(current => {
        const next = { ...current };
        delete next[domain.id];
        return next;
      });
      setCustomSectionNotice({ tone: "success", text: `${domain.hostname} zurückgezogen.` });
    },
    onError: error => setCustomSectionNotice({ tone: "error", text: error.message }),
  });
  const accountDomainsQuery = trpc.funnel.accountDomains.useQuery(undefined, { enabled: Boolean(funnelId) });
  const registerAccountDomain = trpc.funnel.registerAccountDomain.useMutation({
    onSuccess: async (domain) => {
      setAccountHostname("");
      await accountDomainsQuery.refetch();
      await portalDomainsQuery.refetch();
      setAccountSectionNotice({
        tone: "success",
        text: `${domain.hostname} angebunden. CNAME auf ${domain.dnsTarget} setzen, dann DNS prüfen.`,
      });
    },
    onError: error => setAccountSectionNotice({ tone: "error", text: error.message }),
  });
  const markAccountDomainReady = trpc.funnel.markAccountDomainReady.useMutation({
    onSuccess: async (domain) => {
      await accountDomainsQuery.refetch();
      await portalDomainsQuery.refetch();
      setAccountNotices(current => ({
        ...current,
        [domain.id]: {
          tone: "warning",
          text:
            "httpsMessage" in domain && typeof domain.httpsMessage === "string" && domain.httpsMessage
              ? domain.httpsMessage
              : `Aktiv. Liste unter https://${domain.hostname}/. Chrome-Hinweis unten beachten — nicht auf unsichere Seite klicken.`,
        },
      }));
    },
    onError: (error, input) => {
      setAccountNotices(current => ({
        ...current,
        [input.domainId]: { tone: "error", text: error.message },
      }));
    },
  });
  const verifyAccountDomainDns = trpc.funnel.verifyAccountDomainDns.useMutation({
    onSuccess: (result, input) => {
      setAccountNotices(current => ({
        ...current,
        [input.domainId]: {
          tone: result.ok ? (result.warning ? "warning" : "success") : "error",
          text: result.message,
        },
      }));
    },
    onError: (error, input) => {
      setAccountNotices(current => ({
        ...current,
        [input.domainId]: { tone: "error", text: error.message },
      }));
    },
  });
  const revokeAccountDomain = trpc.funnel.revokeAccountDomain.useMutation({
    onSuccess: async (domain) => {
      await accountDomainsQuery.refetch();
      await portalDomainsQuery.refetch();
      setAccountNotices(current => {
        const next = { ...current };
        delete next[domain.id];
        return next;
      });
      setAccountSectionNotice({ tone: "success", text: `${domain.hostname} zurückgezogen.` });
    },
    onError: error => setAccountSectionNotice({ tone: "error", text: error.message }),
  });
  const readyCustomHost = (customDomainsQuery.data ?? []).find(domain => domain.status === "READY");
  const readyAccountHost = (accountDomainsQuery.data ?? []).find(domain => domain.status === "READY");
  const bindablePortalDomains = useMemo(() => {
    const localHosts = new Set(
      (customDomainsQuery.data ?? []).map(domain => domain.hostname),
    );
    return (portalDomainsQuery.data ?? []).filter(
      domain =>
        !localHosts.has(domain.hostname) &&
        (domain.bindingKind === "none" ||
          (domain.bindingKind === "funnel" && domain.bindingRef === funnelId)),
    );
  }, [customDomainsQuery.data, portalDomainsQuery.data, funnelId]);
  const directUrl = useMemo(() => `${window.location.origin}/f/${draft?.slug ?? "karriere"}`, [draft?.slug]);
  const customPublicUrl = readyCustomHost ? `https://${readyCustomHost.hostname}/` : null;
  const legalValid = draft ? legalPagesAreValid(draft).ok : false;
  const metaServerDirty = Boolean(metaTestEventCode !== savedMetaTestEventCode);
  const embedCode = useMemo(() => `<iframe id="adbot-funnel" src="${directUrl}" title="Funnel" loading="lazy" style="width:100%;min-height:780px;border:0;border-radius:16px" allow="clipboard-write"></iframe>\n<script>\nwindow.addEventListener("message",function(event){\n  if(event.origin!==new URL("${directUrl}").origin)return;\n  if(!["adbot-funnel:resize","social-recruiting-funnel:resize"].includes(event.data?.type))return;\n  document.getElementById("adbot-funnel").style.height=event.data.height+"px";\n});\n</script>`, [directUrl]);

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
    const legalCheck = legalPagesAreValid(draft);
    if (!legalCheck.ok) {
      toast.error(legalCheck.message);
      return;
    }
    try {
      if (dirty) await save.mutateAsync({ ...draft, isPublished: draft.status === "published", notificationEmailWrite: "set" });
      if (metaServerDirty) await saveMetaServer.mutateAsync({
        funnelId: draft.id,
        clearAccessToken: false,
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
  const submissionPlural = funnelSubmissionPlural(draft.purpose);

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
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="funnel-purpose">Funnel-Zweck</Label><Select value={draft.purpose} onValueChange={purpose => setDraft({ ...draft, purpose: purpose as FunnelPurpose })}><SelectTrigger id="funnel-purpose"><SelectValue /></SelectTrigger><SelectContent>{FUNNEL_PURPOSE_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">{funnelPurposeOption(draft.purpose).description}</p></div>
          <div className="space-y-2"><Label htmlFor="funnel-slug">URL-Slug</Label><Input id="funnel-slug" value={draft.slug} onChange={event => setDraft({ ...draft, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} /><p className="text-xs text-muted-foreground">Muss über alle Funnel hinweg eindeutig sein.</p></div>
          <div className="space-y-2"><Label htmlFor="notification-email">Empfänger-E-Mail</Label><Input id="notification-email" type="email" value={draft.notificationEmail} placeholder="anfragen@unternehmen.de" onChange={event => setDraft({ ...draft, notificationEmail: event.target.value })} /><p className="text-xs text-muted-foreground">An diese Adresse werden neue {submissionPlural.toLowerCase()} dieses Funnels gemeldet.</p></div>
          <div className="space-y-3 sm:col-span-2">
            <LegalPagesFields
              legal={draft.legal}
              privacyUrl={draft.privacyUrl}
              slug={draft.slug}
              onChange={next => setDraft({ ...draft, ...next })}
            />
          </div>
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="origins">Erlaubte Einbettungs-Domains <span className="font-normal text-muted-foreground">(optional)</span></Label><Textarea id="origins" rows={3} value={draft.allowedEmbedOrigins.join("\n")} placeholder="Nur bei Bedarf, z. B. https://www.unternehmen.de" onChange={event => setDraft({ ...draft, allowedEmbedOrigins: event.target.value.split("\n").map(value => value.trim()).filter(Boolean) })} /><p className="text-xs text-muted-foreground">Eine vollständige Domain pro Zeile inklusive https://.</p></div>
          <div className="flex items-center justify-between rounded-xl border p-4 sm:col-span-2"><div><Label htmlFor="published">Funnel veröffentlicht</Label><p className="mt-1 text-xs text-muted-foreground">Ausschalten pausiert einen bereits veröffentlichten Funnel. Archivierte Funnel stellst du in der Bibliothek wieder her.</p></div><Switch id="published" checked={draft.status === "published"} disabled={draft.status === "archived"} onCheckedChange={setPublished} /></div>
        </div>
        {save.error && <p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{save.error.message}</p>}
        <div className="mt-6 flex justify-end"><Button className="bg-[#0165c3] hover:bg-[#0154a3]" disabled={save.isPending || saveMetaServer.isPending || !draft.title.trim() || !legalValid || (!dirty && !metaServerDirty)} aria-busy={save.isPending || saveMetaServer.isPending} onClick={persistSettings}>{save.isPending || saveMetaServer.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}{save.isPending || saveMetaServer.isPending ? "Wird gespeichert …" : "Einstellungen speichern"}</Button></div>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-[#0165c3]" aria-hidden="true"><Signpost className="size-5" /></span><div><h2 className="font-bold">Nach erfolgreichem Absenden</h2><p className="text-xs text-muted-foreground">Erfolgsnachricht anzeigen oder nach bestätigter Speicherung sicher weiterleiten.</p></div></div>
        <div className="mt-6 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Verhalten nach dem Absenden">
            <button type="button" role="radio" aria-checked={draft.postSubmit.mode === "message"} className={`rounded-xl border p-4 text-left transition ${draft.postSubmit.mode === "message" ? "border-[#0165c3] bg-blue-50 ring-1 ring-[#0165c3]" : "hover:border-slate-300"}`} onClick={() => setDraft({ ...draft, postSubmit: { ...draft.postSubmit, mode: "message" } })}><strong className="block text-sm">Erfolgsnachricht</strong><span className="mt-1 block text-xs text-muted-foreground">Zeigt den im visuellen Editor gepflegten Titel und Text.</span></button>
            <button type="button" role="radio" aria-checked={draft.postSubmit.mode === "redirect"} className={`rounded-xl border p-4 text-left transition ${draft.postSubmit.mode === "redirect" ? "border-[#0165c3] bg-blue-50 ring-1 ring-[#0165c3]" : "hover:border-slate-300"}`} onClick={() => setDraft({ ...draft, postSubmit: { ...draft.postSubmit, mode: "redirect" } })}><strong className="block text-sm">Weiterleitung</strong><span className="mt-1 block text-xs text-muted-foreground">Öffnet erst nach erfolgreicher Speicherung eine externe HTTPS-Adresse.</span></button>
          </div>
          {draft.postSubmit.mode === "redirect" && <div className="space-y-2"><Label htmlFor="redirect-url">Weiterleitungs-URL</Label><Input id="redirect-url" type="url" inputMode="url" placeholder="https://www.unternehmen.de/vielen-dank" value={draft.postSubmit.redirectUrl} onChange={event => setDraft({ ...draft, postSubmit: { ...draft.postSubmit, redirectUrl: event.target.value.trim() } })} /><p className="text-xs text-muted-foreground">Nur absolute HTTPS-Adressen werden gespeichert. Bei einem Fehler bleibt der Eintrag trotzdem erhalten.</p></div>}
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-[#0165c3]" aria-hidden="true"><Target className="size-5" /></span><div><h2 className="font-bold">Meta Conversion Tracking</h2><p className="text-xs text-muted-foreground">Browser-Pixel hier, serverseitige CAPI über die Meta-Verbindung im Adbot-Portal.</p></div></div>
        <div className="mt-6 space-y-5">
          <div className="flex items-center justify-between gap-4 rounded-xl border p-4"><div><Label htmlFor="meta-enabled">Meta-Tracking aktiv</Label><p className="mt-1 text-xs leading-5 text-muted-foreground">Lädt den Browser-Pixel automatisch und meldet Conversions gemäß dem gewählten Zeitpunkt. Serverseitige CAPI (Lead und Gut/Schlecht) geht über die Meta-Verbindung im Adbot-Portal — ohne Events-Manager-Token.</p></div><Switch id="meta-enabled" checked={draft.metaTracking.enabled} onCheckedChange={enabled => setDraft({ ...draft, metaTracking: { ...draft.metaTracking, enabled } })} /></div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="meta-pixel-id">Meta Pixel-ID</Label><Input id="meta-pixel-id" inputMode="numeric" placeholder="123456789012345" value={draft.metaTracking.pixelId} onChange={event => setDraft({ ...draft, metaTracking: { ...draft.metaTracking, pixelId: event.target.value.replace(/\D/g, "").slice(0, 25) } })} /><p className="text-xs text-muted-foreground">Nur Ziffern; gilt für Browser-Pixel und Conversions API. Wird automatisch aus dem Adbot-Portal übernommen, wenn das Feld leer ist.</p></div>
            <div className="space-y-2"><Label htmlFor="meta-event-name">Conversion-Event</Label><Input id="meta-event-name" value={draft.metaTracking.eventName} onChange={event => setDraft({ ...draft, metaTracking: { ...draft.metaTracking, eventName: event.target.value.replace(/[^A-Za-z0-9_]/g, "") } })} /><p className="text-xs text-muted-foreground">Empfohlenes Standardereignis für erfolgreiche Funnel-Abschlüsse: <code>Lead</code>.</p></div>
          </div>
          <div className="space-y-3">
            <Label>Conversion-Zeitpunkt</Label>
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Meta-Conversion-Zeitpunkt">
              <button type="button" role="radio" aria-checked={draft.metaTracking.conversionTrigger === "submit"} className={`rounded-xl border p-4 text-left transition ${draft.metaTracking.conversionTrigger === "submit" ? "border-[#0165c3] bg-blue-50 ring-1 ring-[#0165c3]" : "hover:border-slate-300"}`} onClick={() => setDraft({ ...draft, metaTracking: { ...draft.metaTracking, conversionTrigger: "submit" } })}><strong className="block text-sm">Beim Absenden</strong><span className="mt-1 block text-xs text-muted-foreground">Standard: Pixel und CAPI melden die Conversion direkt nach erfolgreicher Speicherung.</span></button>
              <button type="button" role="radio" aria-checked={draft.metaTracking.conversionTrigger === "doi"} className={`rounded-xl border p-4 text-left transition ${draft.metaTracking.conversionTrigger === "doi" ? "border-[#0165c3] bg-blue-50 ring-1 ring-[#0165c3]" : "hover:border-slate-300"}`} onClick={() => setDraft({ ...draft, metaTracking: { ...draft.metaTracking, conversionTrigger: "doi" } })}><strong className="block text-sm">Nach DOI</strong><span className="mt-1 block text-xs text-muted-foreground">Beim Absenden wird keine Conversion gesendet; die Meldung erfolgt erst nach Double-Opt-In (DOI-Versand folgt).</span></button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-start gap-3"><KeyRound className="mt-0.5 size-5 shrink-0 text-[#0165c3]" aria-hidden="true" /><div><h3 className="text-sm font-bold">Conversions API – über die Meta-Verbindung</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Der Kundenweg: Pixel unter Adbot → Tracking aus dem verbundenen Werbekonto wählen und CAPI prüfen. Adbot sendet Lead und Gut/Schlecht dann mit dem Connection-Token — das Events-Manager-Token ist nicht der Kundenweg und wird für Portal-Konten nicht verwendet. DOI-Trigger sendet beim Absenden noch kein Event.</p></div></div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="meta-test-code">Test-Event-Code <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="meta-test-code" placeholder="TEST12345" value={metaTestEventCode} onChange={event => setMetaTestEventCode(event.target.value.slice(0, 160))} /><p className="text-xs text-muted-foreground">Nur für „Test Events“ im Meta Events Manager; vor Produktivbetrieb leeren.</p></div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-bold">Lead-Qualität und Werte</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Antwortoptionen können im Editor einen Euro-Wert bekommen. Dieser Wert geht automatisch mit dem Funnel-Eingang als Lead an Meta. Zusätzlich kannst du einzelne Eingänge mit Gut oder Schlecht bewerten — das sendet ein zweites Ereignis (`Subscribe` bzw. `DisqualifiedLead`) über die Meta-Verbindung im Portal.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="meta-quality-good">Wert für gute Leads (€)</Label>
                <Input id="meta-quality-good" inputMode="decimal" placeholder="100" value={draft.metaTracking.qualityGoodValue ?? ""} onChange={event => { const raw = event.target.value.trim().replace(",", "."); const next = raw === "" ? undefined : Number(raw); setDraft({ ...draft, metaTracking: { ...draft.metaTracking, qualityGoodValue: next !== undefined && Number.isFinite(next) && next >= 0 && next <= 10000 ? Math.round(next * 100) / 100 : undefined } }); }} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="meta-quality-bad">Wert für schlechte Leads (€)</Label>
                <Input id="meta-quality-bad" inputMode="decimal" placeholder="0" value={draft.metaTracking.qualityBadValue ?? ""} onChange={event => { const raw = event.target.value.trim().replace(",", "."); const next = raw === "" ? undefined : Number(raw); setDraft({ ...draft, metaTracking: { ...draft.metaTracking, qualityBadValue: next !== undefined && Number.isFinite(next) && next >= 0 && next <= 10000 ? Math.round(next * 100) / 100 : undefined } }); }} />
              </div>
            </div>
          </div>
          <div className="flex justify-end"><Button className="bg-[#0165c3] hover:bg-[#0154a3]" disabled={save.isPending || saveMetaServer.isPending || (!dirty && !metaServerDirty)} aria-busy={save.isPending || saveMetaServer.isPending} onClick={persistSettings}>{save.isPending || saveMetaServer.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}{save.isPending || saveMetaServer.isPending ? "Wird gespeichert …" : "Tracking-Einstellungen speichern"}</Button></div>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-[#0165c3]" aria-hidden="true"><Globe className="size-5" /></span><div><h2 className="font-bold">Bestehende Domain anbinden</h2><p className="text-xs text-muted-foreground">Kein Domainkauf. Zwei Stufen: Account-Domain = alle Funnel dieses Kontos unter /f/slug (günstig / klickwerk-Muster). Funnel-Domain = Root zeigt nur diesen Funnel. Nicht parallel am Freebie binden.</p></div></div>
        <ChromeWildcardHostNotice />
        {bindablePortalDomains.length > 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-slate-200 p-4">
            <p className="text-sm font-semibold">Aus Adbot-Domains übernehmen</p>
            <ul className="mt-3 space-y-2">
              {bindablePortalDomains.map(domain => (
                <li className="flex flex-wrap items-center justify-between gap-2 text-sm" key={domain.id}>
                  <span>
                    <code>{domain.hostname}</code>
                    <span className="ml-2 text-xs text-muted-foreground">{domain.status}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!funnelId || bindPortalDomain.isPending}
                    onClick={() =>
                      funnelId &&
                      bindPortalDomain.mutate({
                        funnelId,
                        hostname: domain.hostname,
                      })
                    }
                  >
                    Binden
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <p className="text-sm font-bold">Account-Domain — alle Funnel</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Root zeigt die Stellenliste. Jeder Funnel liegt unter <code>https://Domain/f/slug</code>. Admin landet auf dieser Domain.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Input
              aria-label="Account-Hostname"
              placeholder="funnel.dein-unternehmen.de"
              value={accountHostname}
              onChange={event => setAccountHostname(event.target.value.toLowerCase())}
            />
            <Button
              variant="outline"
              disabled={!accountHostname.trim() || registerAccountDomain.isPending}
              onClick={() => registerAccountDomain.mutate({ hostname: accountHostname.trim() })}
            >
              {registerAccountDomain.isPending ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}
              Für alle Funnel anbinden
            </Button>
          </div>
          <DomainActionNotice notice={accountSectionNotice} />
          <ul className="mt-4 space-y-3">
            {(accountDomainsQuery.data ?? []).map(domain => (
              <li className="rounded-xl border bg-white p-3" key={domain.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold">{domain.hostname}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Status {domain.status} · CNAME → <code>{domain.dnsTarget}</code>
                    </p>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      CNAME auf <code>{domain.dnsTarget}</code>, dann aktivieren. Liste:{" "}
                      <code>https://{domain.hostname}/</code> · dieser Funnel:{" "}
                      <code>https://{domain.hostname}/f/{draft.slug}</code>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {domain.status === "PENDING_DNS" ? (
                      <>
                        <Button size="sm" variant="outline" disabled={verifyAccountDomainDns.isPending} onClick={() => verifyAccountDomainDns.mutate({ domainId: domain.id })}>
                          {verifyAccountDomainDns.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                          Nur DNS prüfen
                        </Button>
                        <Button size="sm" className="bg-[#0165c3] hover:bg-[#0154a3]" disabled={markAccountDomainReady.isPending} onClick={() => markAccountDomainReady.mutate({ domainId: domain.id })}>
                          {markAccountDomainReady.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                          DNS prüfen & aktivieren
                        </Button>
                      </>
                    ) : null}
                    {domain.status === "READY" ? (
                      <>
                        <Button size="sm" variant="outline" disabled={verifyAccountDomainDns.isPending} onClick={() => verifyAccountDomainDns.mutate({ domainId: domain.id })}>
                          {verifyAccountDomainDns.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                          DNS/SSL erneut prüfen
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => window.open(`https://${domain.hostname}/`, "_blank", "noopener,noreferrer")}>
                          <ExternalLink className="size-4" />Öffnen
                        </Button>
                      </>
                    ) : null}
                    <Button size="sm" variant="ghost" disabled={revokeAccountDomain.isPending} onClick={() => revokeAccountDomain.mutate({ domainId: domain.id })}>
                      Zurückziehen
                    </Button>
                  </div>
                </div>
                <DomainActionNotice notice={accountNotices[domain.id]} />
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-6 text-sm font-bold">Nur dieser Funnel — Root-URL</p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <Input
            aria-label="Custom Hostname"
            placeholder="mechatroniker.dein-unternehmen.de"
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
            Domain anbinden
          </Button>
        </div>
        <DomainActionNotice notice={customSectionNotice} />
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
                    1) Beim Domain-Anbieter CNAME <code>{domain.hostname}</code> → <code>{domain.dnsTarget}</code>{" "}
                    (Subdomain, nicht die nackte Root-Domain).{" "}
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
                        DNS/SSL erneut prüfen
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.open(`https://${domain.hostname}/`, "_blank", "noopener,noreferrer")}
                      >
                        <ExternalLink className="size-4" />
                        Öffnen
                      </Button>
                    </>
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
              <DomainActionNotice notice={customNotices[domain.id]} />
            </li>
          ))}
          {(customDomainsQuery.data?.length ?? 0) === 0 ? (
            <li className="text-sm text-muted-foreground">Noch keine bestehende Domain angebunden. Am zuverlässigsten eine Subdomain wie <code>funnel.dein-unternehmen.de</code> mit eigener CNAME-Zeile (nicht nur über <code>*</code>). Der Shared-Host-Pfad `/f/…` bleibt unverändert nutzbar.</li>
          ) : null}
        </ul>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <h2 className="font-bold">Direktlink und optionale WordPress-Einbettung</h2><p className="mt-1 text-sm text-muted-foreground">Der Funnel funktioniert vollständig über die eigenständige URL; die Einbettung ist nur eine zusätzliche Möglichkeit.</p>
        <div className="mt-5 space-y-2"><Label htmlFor="public-funnel-url">Öffentliche Funnel-URL (Shared Host)</Label><div className="flex gap-2"><Input id="public-funnel-url" readOnly value={directUrl} /><Button variant="outline" size="icon" aria-label="URL kopieren" onClick={() => copy(directUrl, "url")}>{copied === "url" ? <Check className="size-4" aria-hidden="true" /> : <Clipboard className="size-4" aria-hidden="true" />}</Button><Button variant="outline" size="icon" aria-label="Funnel öffnen" disabled={draft.status !== "published"} onClick={() => window.open(directUrl, "_blank", "noopener,noreferrer")}><ExternalLink className="size-4" aria-hidden="true" /></Button></div>{draft.status !== "published" && <p className="text-xs text-amber-700">Die URL wird erst nach der Veröffentlichung erreichbar.</p>}</div>
        {readyAccountHost ? (
          <div className="mt-5 space-y-2">
            <Label htmlFor="account-funnel-url">Account-Domain URL dieses Funnels</Label>
            <div className="flex gap-2">
              <Input id="account-funnel-url" readOnly value={`https://${readyAccountHost.hostname}/f/${draft.slug}`} />
              <Button variant="outline" size="icon" aria-label="Account-URL kopieren" onClick={() => copy(`https://${readyAccountHost.hostname}/f/${draft.slug}`, "url")}>
                {copied === "url" ? <Check className="size-4" aria-hidden="true" /> : <Clipboard className="size-4" aria-hidden="true" />}
              </Button>
              <Button variant="outline" size="icon" aria-label="Account-Domain öffnen" disabled={draft.status !== "published"} onClick={() => window.open(`https://${readyAccountHost.hostname}/f/${draft.slug}`, "_blank", "noopener,noreferrer")}>
                <ExternalLink className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ) : null}
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
