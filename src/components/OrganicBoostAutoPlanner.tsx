"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  enabled: boolean;
};

const SESSION_KEY = "adbot.organicBoostAutoPlan.v1";
const START_DELAY_MS = 3_500;

/**
 * Starts Beitrag-Push for already-recognized posts without requiring another
 * content Abruf. Delayed slightly so a concurrent Abruf can finish its lease
 * claim first; uses a short exclusive lease on the server.
 */
export function OrganicBoostAutoPlanner({ enabled }: Props) {
  const router = useRouter();
  const kickoffRef = useRef(false);
  const [ran, setRan] = useState(false);

  useEffect(() => {
    if (!enabled || ran || kickoffRef.current) {
      return;
    }

    if (typeof window !== "undefined") {
      const last = Number(window.sessionStorage.getItem(SESSION_KEY) ?? "0");
      if (Number.isFinite(last) && Date.now() - last < 5 * 60_000) {
        return;
      }
    }

    let cancelled = false;

    const timer = window.setTimeout(() => {
      kickoffRef.current = true;
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
          });
          if (cancelled) {
            return;
          }
          if (response.ok) {
            window.sessionStorage.setItem(SESSION_KEY, String(Date.now()));
            setRan(true);
            router.refresh();
          } else {
            kickoffRef.current = false;
          }
        } catch {
          if (!cancelled) {
            kickoffRef.current = false;
          }
        }
      })();
    }, START_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      // Do not abort an in-flight plan request — that would leave the READ_SYNC
      // lease held while Abruf tries to claim it (marketing_operation_locked).
    };
  }, [enabled, ran, router]);

  return null;
}
