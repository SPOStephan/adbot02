import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { getBrowserHostname, isSharedFunnelHost } from "@/lib/funnelHost";
import { trpc } from "@/lib/trpc";
import { AccountHostLegal } from "./AccountFunnelIndex";
import { HostBoundImprint } from "./FunnelImprint";

/** Custom-host imprint; on shared hosts send users to the classic slug imprint. */
export default function RootImprint() {
  const [, setLocation] = useLocation();
  const shared = isSharedFunnelHost();
  const hostname = getBrowserHostname();
  const catalog = trpc.funnel.publicCatalogByHost.useQuery(
    { hostname },
    { enabled: !shared && Boolean(hostname) },
  );

  useEffect(() => {
    if (shared) setLocation("/f/karriere/impressum", { replace: true });
  }, [shared, setLocation]);

  if (shared) {
    return (
      <div className="funnel-loading" role="status" aria-live="polite">
        Impressum wird geöffnet …
      </div>
    );
  }

  if (catalog.isLoading) {
    return (
      <div className="funnel-loading" role="status" aria-live="polite">
        <Loader2 className="animate-spin" aria-hidden="true" />
        <span>Impressum wird geladen …</span>
      </div>
    );
  }

  if (catalog.data?.kind === "account") {
    return (
      <AccountHostLegal
        kind="imprint"
        hostname={catalog.data.hostname}
        funnels={catalog.data.funnels}
      />
    );
  }

  return <HostBoundImprint />;
}
