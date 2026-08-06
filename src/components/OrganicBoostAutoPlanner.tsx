"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  enabled: boolean;
};

/**
 * Starts Beitrag-Push for already-recognized posts without requiring another
 * content Abruf. Runs once per mount when Vollautomatik + Freigabe are ready.
 */
export function OrganicBoostAutoPlanner({ enabled }: Props) {
  const router = useRouter();
  const startedRef = useRef(false);
  const [ran, setRan] = useState(false);

  useEffect(() => {
    if (!enabled || startedRef.current || ran) {
      return;
    }

    startedRef.current = true;
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch("/api/meta/automation/organic-boost/plan", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: "{}",
          signal: controller.signal,
        });
        if (response.ok) {
          setRan(true);
          router.refresh();
        } else {
          startedRef.current = false;
        }
      } catch {
        startedRef.current = false;
      }
    })();

    return () => {
      controller.abort();
    };
  }, [enabled, ran, router]);

  return null;
}
