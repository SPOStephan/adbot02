import { useEffect } from "react";
import { useLocation } from "wouter";
import { isSharedFunnelHost } from "@/lib/funnelHost";
import { HostBoundFunnel } from "./Funnel";

export default function Home() {
  const [, setLocation] = useLocation();
  const shared = isSharedFunnelHost();

  useEffect(() => {
    if (shared) setLocation("/f/karriere", { replace: true });
  }, [shared, setLocation]);

  if (shared) {
    return <div className="funnel-loading">Funnel wird geöffnet …</div>;
  }

  return <HostBoundFunnel />;
}
