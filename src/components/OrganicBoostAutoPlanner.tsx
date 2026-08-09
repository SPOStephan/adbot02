"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type OrganicBoostResult = {
  status?: string | null;
  plansCreated?: number;
  plansExisting?: number;
  candidatesConsidered?: number;
  lastError?: string | null;
  executorSucceeded?: number;
  executorRuns?: number;
};

type Props = {
  enabled: boolean;
  pendingCandidateCount: number;
};

const SESSION_KEY = "adbot.organicBoostAutoPlan.v3";
const START_DELAY_MS = 2_000;
const RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 90_000;

/**
 * Backup path: starts Beitrag-Push for already-recognized posts while the
 * dashboard stays open. Primary path is server-side plan+drain on Abruf and
 * dashboard load — this only retries if candidates remain pending.
 */
export function OrganicBoostAutoPlanner({
  enabled,
  pendingCandidateCount,
}: Props) {
  const router = useRouter();
  const inFlightRef = useRef(false);
  const attemptRef = useRef(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!enabled || done || pendingCandidateCount < 1) {
      return;
    }

    let cancelled = false;
    let retryTimer = 0;
    let startTimer = 0;

    const schedule = (delayMs: number) => {
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(run, delayMs);
    };

    const run = () => {
      if (cancelled || inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      attemptRef.current += 1;

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

          const body = (await response.json().catch(() => ({}))) as {
            ok?: boolean;
            organicBoost?: OrganicBoostResult;
          };

          if (!response.ok || body.ok !== true) {
            inFlightRef.current = false;
            router.refresh();
            const delay = Math.min(
              RETRY_DELAY_MS * attemptRef.current,
              MAX_RETRY_DELAY_MS,
            );
            schedule(delay);
            return;
          }

          const created = body.organicBoost?.plansCreated ?? 0;
          const executed = body.organicBoost?.executorSucceeded ?? 0;

          // Only treat as done when THIS pass created plans or wrote to Meta.
          // plansExisting alone must not stop retries for newly recognized posts.
          if (created > 0 || executed > 0) {
            window.sessionStorage.setItem(
              SESSION_KEY,
              JSON.stringify({ at: Date.now(), pending: pendingCandidateCount }),
            );
            setDone(true);
            router.refresh();
            return;
          }

          inFlightRef.current = false;
          router.refresh();
          const delay = Math.min(
            RETRY_DELAY_MS * attemptRef.current,
            MAX_RETRY_DELAY_MS,
          );
          schedule(delay);
        } catch {
          if (!cancelled) {
            inFlightRef.current = false;
            const delay = Math.min(
              RETRY_DELAY_MS * attemptRef.current,
              MAX_RETRY_DELAY_MS,
            );
            schedule(delay);
          }
        }
      })();
    };

    startTimer = window.setTimeout(run, START_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      window.clearTimeout(retryTimer);
    };
  }, [done, enabled, pendingCandidateCount, router]);

  // New pending candidates after a prior "done" must retry.
  useEffect(() => {
    if (pendingCandidateCount < 1) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) {
      setDone(false);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as { pending?: number };
      if ((parsed.pending ?? 0) < pendingCandidateCount) {
        setDone(false);
      }
    } catch {
      setDone(false);
    }
  }, [pendingCandidateCount]);

  return null;
}
