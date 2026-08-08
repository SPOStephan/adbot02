import { useEffect } from "react";
import { useLocation } from "wouter";

export default function Home() {
  const [, setLocation] = useLocation();
  useEffect(() => setLocation("/f/karriere", { replace: true }), [setLocation]);
  return <div className="funnel-loading">Funnel wird geöffnet …</div>;
}
