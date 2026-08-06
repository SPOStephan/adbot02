"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

type Props = {
  /** True while plans are still being created or written to Meta. */
  active: boolean;
};

const INTERVAL_MS = 15_000;
const MAX_DURATION_MS = 15 * 60_000;

/**
 * Soft-polls the dashboard while Beitrag-Push is in flight so the Ampel
 * appears without manual browser refresh. Stops once inactive or after
 * a safety timeout.
 */
export function OrganicBoostLiveRefresh({ active }: Props) {
  const router = useRouter();
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      startedAtRef.current = null;
      return;
    }

    if (startedAtRef.current === null) {
      startedAtRef.current = Date.now();
    }

    const tick = () => {
      const startedAt = startedAtRef.current;
      if (startedAt !== null && Date.now() - startedAt > MAX_DURATION_MS) {
        return;
      }
      router.refresh();
    };

    const interval = window.setInterval(tick, INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [active, router]);

  if (!active) {
    return null;
  }

  return (
    <p
      className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500"
      role="status"
    >
      <RefreshCw className="size-3.5 animate-spin" aria-hidden />
      Aktualisiert automatisch …
    </p>
  );
}
