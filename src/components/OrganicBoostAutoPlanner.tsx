"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type OrganicBoostResult = {
  status?: string | null;
  plansCreated?: number;
  plansExisting?: number;
  candidatesConsidered?: number;
  lastError?: string | null;
};

type Props = {
  enabled: boolean;
  pendingCandidateCount: number;
};

const SESSION_KEY = "adbot.organicBoostAutoPlan.v2";
const START_DELAY_MS = 2_000;
const RETRY_DELAY_MS = 10_000;
const MAX_RETRY_DELAY_MS = 60_000;

function plansReady(boost: OrganicBoostResult | null | undefined): boolean {
  return (boost?.plansCreated ?? 0) + (boost?.plansExisting ?? 0) > 0;
}

/**
 * Starts Beitrag-Push for already-recognized posts without requiring another
 * content Abruf or a manual button click. Keeps retrying while Autonomie gates
 * are open and candidates remain pending.
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

    if (typeof window !== "undefined") {
      const raw = window.sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as {
            at?: number;
            created?: boolean;
          };
          if (
            parsed.created === true &&
            Number.isFinite(parsed.at) &&
            Date.now() - Number(parsed.at) < 5 * 60_000
          ) {
            return;
          }
        } catch {
          // ignore corrupt session marker
        }
      }
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

          if (plansReady(body.organicBoost)) {
            window.sessionStorage.setItem(
              SESSION_KEY,
              JSON.stringify({ at: Date.now(), created: true }),
            );
            setDone(true);
            router.refresh();
            return;
          }

          // Surface planner status/errors in the dashboard, then retry.
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

  return null;
}
