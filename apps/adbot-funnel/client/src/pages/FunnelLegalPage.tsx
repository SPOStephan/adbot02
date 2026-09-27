import { useEffect } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useRoute } from "wouter";
import { FunnelChrome } from "@/components/funnel/FunnelChrome";
import { applyFunnelDocumentBranding } from "@/lib/favicon";
import { getBrowserHostname } from "@/lib/funnelHost";
import { legalFooterLinks, isHttpsUrl, resolveLegalPageMode } from "@shared/legalPages";
import { trpc } from "@/lib/trpc";
import type { FunnelConfig } from "@shared/funnel";

export type LegalPageKind = "imprint" | "privacy";

function legalCopy(kind: LegalPageKind, config: FunnelConfig) {
  if (kind === "imprint") {
    return {
      mode: resolveLegalPageMode(config.legal.imprintMode, "internal"),
      externalUrl: config.legal.imprintUrl,
      title: config.legal.imprintTitle,
      content: config.legal.imprintContent,
      loading: "Impressum wird geladen …",
      missing: "Das Impressum ist gerade nicht erreichbar.",
    };
  }
  return {
    mode: resolveLegalPageMode(config.legal.privacyMode, "external"),
    externalUrl: config.privacyUrl,
    title: config.legal.privacyTitle,
    content: config.legal.privacyContent,
    loading: "Datenschutz wird geladen …",
    missing: "Die Datenschutzerklärung ist gerade nicht erreichbar.",
  };
}

export function LegalPageView({
  kind,
  config,
  isLoading,
  error,
  funnelUrl,
  imprintPath,
  privacyPath,
}: {
  kind: LegalPageKind;
  config: FunnelConfig | undefined;
  isLoading: boolean;
  error: boolean;
  funnelUrl: string;
  imprintPath: string;
  privacyPath: string;
}) {
  const copy = config ? legalCopy(kind, config) : null;
  const footer = config ? legalFooterLinks(config, { imprintUrl: imprintPath, privacyUrl: privacyPath }) : null;

  useEffect(() => {
    if (!config || !copy) return;
    return applyFunnelDocumentBranding({
      title: `${copy.title} · ${config.title}`,
      faviconUrl: config.brand.faviconUrl,
    });
  }, [config, copy]);

  useEffect(() => {
    if (!copy || copy.mode !== "external" || !isHttpsUrl(copy.externalUrl)) return;
    window.location.replace(copy.externalUrl.trim());
  }, [copy]);

  if (isLoading || (copy?.mode === "external" && isHttpsUrl(copy.externalUrl))) {
    return (
      <div className="funnel-loading" role="status" aria-live="polite">
        <Loader2 className="animate-spin" aria-hidden="true" />
        <span>{copy?.mode === "external" ? "Weiterleitung …" : copy?.loading ?? "Seite wird geladen …"}</span>
      </div>
    );
  }
  if (!config || !copy || !footer || error) {
    return (
      <div className="funnel-loading funnel-error" role="alert">
        <strong>{copy?.missing ?? "Die Seite ist gerade nicht erreichbar."}</strong>
        <span>Bitte versuche es später erneut.</span>
      </div>
    );
  }

  return (
    <FunnelChrome
      brand={config.brand}
      socialProof={{ ...config.socialProof, enabled: false }}
      privacyUrl={footer.privacyUrl}
      privacyLabel={footer.privacyLabel}
      privacyExternal={footer.privacyExternal}
      imprintUrl={footer.imprintUrl}
      imprintExternal={footer.imprintExternal}
      step={0}
      totalSteps={1}
      showProgress={false}
    >
      <section className="funnel-legal" aria-labelledby="funnel-legal-title">
        <a className="funnel-legal-back" href={funnelUrl}>
          <ArrowLeft size={16} aria-hidden="true" />
          Zurück zum Funnel
        </a>
        <div className="funnel-legal-card">
          <h1 id="funnel-legal-title">{copy.title}</h1>
          <div className="funnel-legal-content">{copy.content}</div>
        </div>
      </section>
    </FunnelChrome>
  );
}

export default function FunnelImprint() {
  const [, params] = useRoute("/f/:slug/impressum");
  const slug = params?.slug ?? "karriere";
  const query = trpc.funnel.publicConfig.useQuery({ slug, hostname: getBrowserHostname() });
  return (
    <LegalPageView
      kind="imprint"
      config={query.data}
      isLoading={query.isLoading}
      error={Boolean(query.error)}
      funnelUrl={`/f/${slug}`}
      imprintPath={`/f/${slug}/impressum`}
      privacyPath={`/f/${slug}/datenschutz`}
    />
  );
}

export function FunnelPrivacy() {
  const [, params] = useRoute("/f/:slug/datenschutz");
  const slug = params?.slug ?? "karriere";
  const query = trpc.funnel.publicConfig.useQuery({ slug, hostname: getBrowserHostname() });
  return (
    <LegalPageView
      kind="privacy"
      config={query.data}
      isLoading={query.isLoading}
      error={Boolean(query.error)}
      funnelUrl={`/f/${slug}`}
      imprintPath={`/f/${slug}/impressum`}
      privacyPath={`/f/${slug}/datenschutz`}
    />
  );
}

export function HostBoundImprint() {
  const hostname = getBrowserHostname();
  const query = trpc.funnel.publicConfigByHost.useQuery(
    { hostname },
    { enabled: Boolean(hostname) },
  );
  return (
    <LegalPageView
      kind="imprint"
      config={query.data}
      isLoading={query.isLoading}
      error={Boolean(query.error)}
      funnelUrl="/"
      imprintPath="/impressum"
      privacyPath="/datenschutz"
    />
  );
}

export function HostBoundPrivacy() {
  const hostname = getBrowserHostname();
  const query = trpc.funnel.publicConfigByHost.useQuery(
    { hostname },
    { enabled: Boolean(hostname) },
  );
  return (
    <LegalPageView
      kind="privacy"
      config={query.data}
      isLoading={query.isLoading}
      error={Boolean(query.error)}
      funnelUrl="/"
      imprintPath="/impressum"
      privacyPath="/datenschutz"
    />
  );
}
