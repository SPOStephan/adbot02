import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute } from "wouter";
import { CircleCheckBig, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { applyFunnelDocumentBranding } from "@/lib/favicon";
import { applyPostSubmitAction } from "@/lib/postSubmit";
import { createMetaEventId, loadMetaPixel, readMetaBrowserIdentifiers, trackMetaConversion } from "@/lib/metaPixel";
import { getBrowserHostname } from "@/lib/funnelHost";
import type { ApplicationContact, FunnelAnswers, FunnelConfig } from "@shared/funnel";
import { funnelUiCopy, resolveAddressForm } from "@shared/addressForm";
import {
  FUNNEL_HANDOFF_STORAGE_KEY,
  firstUnansweredStep,
  mergeHandoffAnswers,
  resolveKnockout,
  type FunnelHandoffPayload,
  type ResolvedKnockout,
} from "@shared/funnelGate";
import { resolveStartLayout } from "@shared/startLayout";
import { FunnelChrome } from "@/components/funnel/FunnelChrome";
import { StartStep } from "@/components/funnel/StartStep";
import { ChoiceStep } from "@/components/funnel/ChoiceStep";
import { ContactStep, type ResumeDraft } from "@/components/funnel/ContactStep";
import { ExitStep } from "@/components/funnel/ExitStep";

function EmbedHeightReporter() {
  useEffect(() => {
    if (window.parent === window) return;
    const report = () => window.parent.postMessage({ type: "social-recruiting-funnel:resize", height: document.documentElement.scrollHeight }, "*");
    const observer = new ResizeObserver(report);
    observer.observe(document.body);
    report();
    return () => observer.disconnect();
  }, []);
  return null;
}

type FunnelPaths = {
  funnelUrl: string;
  imprintUrl: string;
};

function FunnelView({
  config,
  isLoading,
  loadError,
  paths,
}: {
  config: FunnelConfig | undefined;
  isLoading: boolean;
  loadError: boolean;
  paths: FunnelPaths;
}) {
  const submit = trpc.funnel.submit.useMutation();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<FunnelAnswers>({});
  const [contact, setContact] = useState<ApplicationContact>({});
  const [consent, setConsent] = useState(false);
  const [resume, setResume] = useState<ResumeDraft>();
  const [validationError, setValidationError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [gate, setGate] = useState<ResolvedKnockout | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const pendingMetaEventId = useRef<string | undefined>(undefined);
  const handoffTargetQuery = trpc.funnel.handoffTarget.useQuery(
    { id: gate?.handoffFunnelId ?? "" },
    { enabled: Boolean(gate?.action === "handoff" && gate.handoffFunnelId) },
  );

  useEffect(() => {
    if (!config) return;
    return applyFunnelDocumentBranding({ title: config.title, faviconUrl: config.brand.faviconUrl });
  }, [config]);

  useEffect(() => {
    if (config?.metaTracking.enabled) loadMetaPixel(config.metaTracking.pixelId);
  }, [config?.metaTracking.enabled, config?.metaTracking.pixelId]);

  const utm = useMemo(() => {
    if (typeof window === "undefined") return {};
    const result: Record<string, string> = {};
    new URLSearchParams(window.location.search).forEach((value, key) => { if (key.startsWith("utm_")) result[key] = value; });
    return result;
  }, []);

  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.requestAnimationFrame(() => topRef.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true }));
  }, [step, submitted, gate]);

  useEffect(() => {
    if (!config || typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(FUNNEL_HANDOFF_STORAGE_KEY);
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as FunnelHandoffPayload;
      if (payload.targetFunnelId !== config.id) return;
      setAnswers(current => mergeHandoffAnswers(current, payload.answers));
      setContact(current => ({ ...payload.contact, ...current }));
      setStep(firstUnansweredStep(config.pages, payload.answers));
      window.sessionStorage.removeItem(FUNNEL_HANDOFF_STORAGE_KEY);
    } catch {
      window.sessionStorage.removeItem(FUNNEL_HANDOFF_STORAGE_KEY);
    }
  }, [config]);

  if (isLoading) return <div className="funnel-loading" role="status" aria-live="polite"><Loader2 className="animate-spin" aria-hidden="true" /><span>Funnel wird geladen …</span></div>;
  if (!config || loadError) return <div className="funnel-loading funnel-error" role="alert"><strong>Dieser Funnel ist gerade nicht erreichbar.</strong><span>Bitte versuche es später erneut.</span></div>;

  const ui = funnelUiCopy(resolveAddressForm(config.addressForm));
  const currentPage = config.pages[step];
  const contactPage = config.pages.find(page => page.type === "contact");
  const next = () => setStep(current => Math.min(current + 1, config.pages.length - 1));
  const back = () => {
    if (gate) {
      setGate(null);
      return;
    }
    setStep(current => Math.max(current - 1, 0));
  };
  const continueFromChoice = () => {
    if (!currentPage || (currentPage.type !== "choice-grid" && currentPage.type !== "choice-list")) {
      next();
      return;
    }
    const knockout = resolveKnockout(currentPage, answers[currentPage.questionKey] ?? []);
    if (knockout) {
      setGate(knockout);
      return;
    }
    next();
  };
  const continueHandoff = () => {
    const target = handoffTargetQuery.data;
    if (!target || !gate) return;
    const payload: FunnelHandoffPayload = {
      sourceFunnelId: config.id,
      sourceSlug: config.slug,
      sourceTitle: config.title,
      targetFunnelId: target.id,
      answers,
      contact,
    };
    window.sessionStorage.setItem(FUNNEL_HANDOFF_STORAGE_KEY, JSON.stringify(payload));
    window.location.assign(`/f/${target.slug}?handoff=1`);
  };
  const choose = (key: string, value: string, multiple: boolean) => setAnswers(current => {
    const selected = current[key] ?? [];
    return { ...current, [key]: multiple ? (selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]) : [value] };
  });
  const send = () => {
    if (!currentPage || currentPage.type !== "contact") return;
    for (const field of currentPage.fields) {
      if (field.enabled && field.required && !contact[field.key]?.trim()) {
        setValidationError(ui.fillField(field.label)); return;
      }
    }
    if (currentPage.consentRequired && !consent) { setValidationError(ui.consentRequired); return; }
    if (currentPage.resumeRequired && !resume) { setValidationError(ui.resumeRequired); return; }
    setValidationError("");
    const trackOnSubmit =
      config.metaTracking.enabled && config.metaTracking.conversionTrigger !== "doi";
    const metaEventId = trackOnSubmit
      ? (pendingMetaEventId.current ??= createMetaEventId())
      : undefined;
    const metaBrowserIdentifiers = metaEventId ? readMetaBrowserIdentifiers() : {};
    submit.mutate({
      funnelSlug: config.slug,
      answers,
      contact,
      consent,
      metaEventId,
      ...metaBrowserIdentifiers,
      sourceUrl: window.location.href,
      utm,
      resume: resume ? { fileName: resume.file.name, mimeType: resume.file.type as "application/pdf", size: resume.file.size, dataBase64: resume.dataBase64 } : undefined,
    }, { onSuccess: result => {
      if (metaEventId) {
        trackMetaConversion(
          config.metaTracking.pixelId,
          config.metaTracking.eventName,
          metaEventId,
          result.leadValue !== undefined ? { value: result.leadValue, currency: "EUR" } : undefined,
        );
      }
      pendingMetaEventId.current = undefined;
      applyPostSubmitAction(config.postSubmit, () => setSubmitted(true));
    }, onError: error => setValidationError(error.message) });
  };

  return (
    <div ref={topRef}>
      <EmbedHeightReporter />
      <FunnelChrome brand={config.brand} socialProof={config.socialProof} privacyUrl={config.privacyUrl} privacyLabel={config.privacyLabel} imprintUrl={paths.imprintUrl} step={step} totalSteps={config.pages.length} showProgress={!submitted && !gate} pages={config.pages} progress={config.progress} onBack={back} onForward={next} wordmark={ui.wordmark} fullBleed={!submitted && !gate && currentPage?.type === "start" && resolveStartLayout(currentPage) === "benefits"}>
        {submitted && contactPage?.type === "contact" ? (
          <section className="funnel-success" aria-live="polite" aria-labelledby="funnel-success-title"><span className="funnel-success-icon" aria-hidden="true"><CircleCheckBig /></span><p className="funnel-eyebrow">{ui.successEyebrow}</p><h1 id="funnel-success-title" tabIndex={-1}>{contactPage.successTitle}</h1><p>{contactPage.successText}</p></section>
        ) : gate ? (
          <ExitStep
            gate={config.gate}
            mode={gate.action === "handoff" && handoffTargetQuery.data ? "handoff" : "exit"}
            targetTitle={handoffTargetQuery.data?.title}
            continueLabel={ui.continueHandoff}
            onContinue={gate.action === "handoff" && handoffTargetQuery.data ? continueHandoff : undefined}
          />
        ) : currentPage?.type === "start" ? (
          <StartStep page={currentPage} brand={config.brand} onContinue={next} />
        ) : currentPage?.type === "choice-grid" || currentPage?.type === "choice-list" ? (
          <ChoiceStep page={currentPage} selected={answers[currentPage.questionKey] ?? []} onSelect={value => choose(currentPage.questionKey, value, currentPage.allowMultiple)} onBack={back} onContinue={continueFromChoice} />
        ) : currentPage?.type === "contact" ? (
          <ContactStep page={currentPage} contact={contact} consent={consent} resume={resume} error={validationError || submit.error?.message} pending={submit.isPending} onContactChange={(key, value) => setContact(current => ({ ...current, [key]: value }))} onConsentChange={setConsent} onResumeChange={setResume} onFileError={setValidationError} onBack={back} onSubmit={send} addressForm={config.addressForm} />
        ) : null}
      </FunnelChrome>
    </div>
  );
}

export default function Funnel() {
  const [, params] = useRoute("/f/:slug");
  const slug = params?.slug ?? "karriere";
  const query = trpc.funnel.publicConfig.useQuery({ slug });
  return (
    <FunnelView
      config={query.data}
      isLoading={query.isLoading}
      loadError={Boolean(query.error)}
      paths={{
        funnelUrl: `/f/${slug}`,
        imprintUrl: `/f/${slug}/impressum`,
      }}
    />
  );
}

/** Custom-domain root: Host → READY funnel. */
export function HostBoundFunnel() {
  const hostname = getBrowserHostname();
  const query = trpc.funnel.publicConfigByHost.useQuery(
    { hostname },
    { enabled: Boolean(hostname) },
  );
  return (
    <FunnelView
      config={query.data}
      isLoading={query.isLoading}
      loadError={Boolean(query.error)}
      paths={{
        funnelUrl: "/",
        imprintUrl: "/impressum",
      }}
    />
  );
}
