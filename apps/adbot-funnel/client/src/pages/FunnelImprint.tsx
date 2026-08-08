import { useEffect } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useRoute } from "wouter";
import { FunnelChrome } from "@/components/funnel/FunnelChrome";
import { applyFunnelDocumentBranding } from "@/lib/favicon";
import { trpc } from "@/lib/trpc";

export default function FunnelImprint() {
  const [, params] = useRoute("/f/:slug/impressum");
  const slug = params?.slug ?? "karriere";
  const { data: config, isLoading, error } = trpc.funnel.publicConfig.useQuery({ slug });

  useEffect(() => {
    if (!config) return;
    return applyFunnelDocumentBranding({ title: `${config.legal.imprintTitle} · ${config.title}`, faviconUrl: config.brand.faviconUrl });
  }, [config]);

  if (isLoading) return <div className="funnel-loading" role="status" aria-live="polite"><Loader2 className="animate-spin" aria-hidden="true" /><span>Impressum wird geladen …</span></div>;
  if (!config || error) return <div className="funnel-loading funnel-error" role="alert"><strong>Das Impressum ist gerade nicht erreichbar.</strong><span>Bitte versuche es später erneut.</span></div>;

  const funnelUrl = `/f/${config.slug}`;
  return (
    <FunnelChrome brand={config.brand} socialProof={{ ...config.socialProof, enabled: false }} privacyUrl={config.privacyUrl} privacyLabel={config.privacyLabel} imprintUrl={`/f/${config.slug}/impressum`} step={0} totalSteps={1} showProgress={false}>
      <section className="funnel-legal" aria-labelledby="funnel-imprint-title">
        <a className="funnel-legal-back" href={funnelUrl}><ArrowLeft size={16} aria-hidden="true" />Zurück zur Bewerbung</a>
        <div className="funnel-legal-card">
          <h1 id="funnel-imprint-title">{config.legal.imprintTitle}</h1>
          <div className="funnel-legal-content">{config.legal.imprintContent}</div>
        </div>
      </section>
    </FunnelChrome>
  );
}
