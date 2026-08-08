import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute } from "wouter";
import { CircleCheckBig, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { applyFunnelDocumentBranding } from "@/lib/favicon";
import { applyPostSubmitAction } from "@/lib/postSubmit";
import { createMetaEventId, loadMetaPixel, readMetaBrowserIdentifiers, trackMetaConversion } from "@/lib/metaPixel";
import type { ApplicationContact, FunnelAnswers } from "@shared/funnel";
import { FunnelChrome } from "@/components/funnel/FunnelChrome";
import { StartStep } from "@/components/funnel/StartStep";
import { ChoiceStep } from "@/components/funnel/ChoiceStep";
import { ContactStep, type ResumeDraft } from "@/components/funnel/ContactStep";

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

export default function Funnel() {
  const [, params] = useRoute("/f/:slug");
  const slug = params?.slug ?? "karriere";
  const { data: config, isLoading, error: loadError } = trpc.funnel.publicConfig.useQuery({ slug });
  const submit = trpc.funnel.submit.useMutation();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<FunnelAnswers>({});
  const [contact, setContact] = useState<ApplicationContact>({});
  const [consent, setConsent] = useState(false);
  const [resume, setResume] = useState<ResumeDraft>();
  const [validationError, setValidationError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const pendingMetaEventId = useRef<string | undefined>(undefined);

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
  }, [step, submitted]);

  if (isLoading) return <div className="funnel-loading" role="status" aria-live="polite"><Loader2 className="animate-spin" aria-hidden="true" /><span>Funnel wird geladen …</span></div>;
  if (!config || loadError) return <div className="funnel-loading funnel-error" role="alert"><strong>Dieser Funnel ist gerade nicht erreichbar.</strong><span>Bitte versuche es später erneut.</span></div>;

  const currentPage = config.pages[step];
  const contactPage = config.pages.find(page => page.type === "contact");
  const next = () => setStep(current => Math.min(current + 1, config.pages.length - 1));
  const back = () => setStep(current => Math.max(current - 1, 0));
  const choose = (key: string, value: string, multiple: boolean) => setAnswers(current => {
    const selected = current[key] ?? [];
    return { ...current, [key]: multiple ? (selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]) : [value] };
  });
  const send = () => {
    if (!currentPage || currentPage.type !== "contact") return;
    for (const field of currentPage.fields) {
      if (field.enabled && field.required && !contact[field.key]?.trim()) {
        setValidationError(`Bitte fülle das Feld „${field.label}“ aus.`); return;
      }
    }
    if (currentPage.consentRequired && !consent) { setValidationError("Bitte bestätige die Datenschutz-Einwilligung."); return; }
    if (currentPage.resumeRequired && !resume) { setValidationError("Bitte lade deinen Lebenslauf hoch."); return; }
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
    }, { onSuccess: () => {
      if (metaEventId) trackMetaConversion(config.metaTracking.pixelId, config.metaTracking.eventName, metaEventId);
      pendingMetaEventId.current = undefined;
      applyPostSubmitAction(config.postSubmit, () => setSubmitted(true));
    }, onError: error => setValidationError(error.message) });
  };

  return (
    <div ref={topRef}>
      <EmbedHeightReporter />
      <FunnelChrome brand={config.brand} socialProof={config.socialProof} privacyUrl={config.privacyUrl} privacyLabel={config.privacyLabel} imprintUrl={`/f/${config.slug}/impressum`} step={step} totalSteps={config.pages.length} showProgress={!submitted}>
        {submitted && contactPage?.type === "contact" ? (
          <section className="funnel-success" aria-live="polite" aria-labelledby="funnel-success-title"><span className="funnel-success-icon" aria-hidden="true"><CircleCheckBig /></span><p className="funnel-eyebrow">Erfolgreich übermittelt</p><h1 id="funnel-success-title" tabIndex={-1}>{contactPage.successTitle}</h1><p>{contactPage.successText}</p></section>
        ) : currentPage?.type === "start" ? (
          <StartStep page={currentPage} onContinue={next} />
        ) : currentPage?.type === "choice-grid" || currentPage?.type === "choice-list" ? (
          <ChoiceStep page={currentPage} selected={answers[currentPage.questionKey] ?? []} onSelect={value => choose(currentPage.questionKey, value, currentPage.allowMultiple)} onBack={back} onContinue={next} />
        ) : currentPage?.type === "contact" ? (
          <ContactStep page={currentPage} contact={contact} consent={consent} resume={resume} error={validationError || submit.error?.message} pending={submit.isPending} onContactChange={(key, value) => setContact(current => ({ ...current, [key]: value }))} onConsentChange={setConsent} onResumeChange={setResume} onFileError={setValidationError} onBack={back} onSubmit={send} />
        ) : null}
      </FunnelChrome>
    </div>
  );
}
