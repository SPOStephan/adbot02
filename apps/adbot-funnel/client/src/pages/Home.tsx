import { useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { isSharedFunnelHost, getBrowserHostname } from "@/lib/funnelHost";
import { trpc } from "@/lib/trpc";
import { HostBoundFunnel } from "./Funnel";
import { AccountFunnelIndex } from "./AccountFunnelIndex";

export default function Home() {
  const [, setLocation] = useLocation();
  const shared = isSharedFunnelHost();
  const hostname = getBrowserHostname();
  const catalog = trpc.funnel.publicCatalogByHost.useQuery(
    { hostname },
    { enabled: !shared && Boolean(hostname) },
  );

  useEffect(() => {
    if (shared) setLocation("/f/karriere", { replace: true });
  }, [shared, setLocation]);

  if (shared) {
    return <div className="funnel-loading">Funnel wird geöffnet …</div>;
  }

  if (catalog.isLoading) {
    return (
      <div className="funnel-loading" role="status" aria-live="polite">
        <Loader2 className="animate-spin" aria-hidden="true" />
        <span>Domain wird erkannt …</span>
      </div>
    );
  }

  if (catalog.data?.kind === "account") {
    return <AccountFunnelIndex hostname={catalog.data.hostname} funnels={catalog.data.funnels} />;
  }

  return <HostBoundFunnel />;
}
