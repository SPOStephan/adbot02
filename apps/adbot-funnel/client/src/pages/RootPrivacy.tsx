import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { getBrowserHostname, isSharedFunnelHost } from "@/lib/funnelHost";
import { trpc } from "@/lib/trpc";
import { AccountHostLegal } from "./AccountFunnelIndex";
import { HostBoundPrivacy } from "./FunnelLegalPage";

/** Custom-host privacy; on shared hosts send users to the classic slug privacy page. */
export default function RootPrivacy() {
  const [, setLocation] = useLocation();
  const shared = isSharedFunnelHost();
  const hostname = getBrowserHostname();
  const catalog = trpc.funnel.publicCatalogByHost.useQuery(
    { hostname },
    { enabled: !shared && Boolean(hostname) },
  );

  useEffect(() => {
    if (shared) setLocation("/f/karriere/datenschutz", { replace: true });
  }, [shared, setLocation]);

  if (shared) {
    return (
      <div className="funnel-loading" role="status" aria-live="polite">
        Datenschutz wird geöffnet …
      </div>
    );
  }

  if (catalog.isLoading) {
    return (
      <div className="funnel-loading" role="status" aria-live="polite">
        <Loader2 className="animate-spin" aria-hidden="true" />
        <span>Datenschutz wird geladen …</span>
      </div>
    );
  }

  if (catalog.data?.kind === "account") {
    return (
      <AccountHostLegal
        kind="privacy"
        hostname={catalog.data.hostname}
        funnels={catalog.data.funnels}
      />
    );
  }

  return <HostBoundPrivacy />;
}
