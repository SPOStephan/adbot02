import { useEffect } from "react";
import { useLocation } from "wouter";
import { isSharedFunnelHost } from "@/lib/funnelHost";
import { HostBoundImprint } from "./FunnelImprint";

/** Custom-host imprint; on shared hosts send users to the classic slug imprint. */
export default function RootImprint() {
  const [, setLocation] = useLocation();
  const shared = isSharedFunnelHost();

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

  return <HostBoundImprint />;
}
