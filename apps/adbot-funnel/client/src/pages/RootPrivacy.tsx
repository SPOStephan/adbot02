import { useEffect } from "react";
import { useLocation } from "wouter";
import { isSharedFunnelHost } from "@/lib/funnelHost";
import { HostBoundPrivacy } from "./FunnelLegalPage";

/** Custom-host privacy; on shared hosts send users to the classic slug privacy page. */
export default function RootPrivacy() {
  const [, setLocation] = useLocation();
  const shared = isSharedFunnelHost();

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

  return <HostBoundPrivacy />;
}
