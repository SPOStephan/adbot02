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
const START_DELAY_MS = 2_500;
const RETRY_DELAY_MS = 12_000;
const MAX_ATTEMPTS = 3;

function plansReady(boost: OrganicBoostResult | null | undefined): boolean {
  return (boost?.plansCreated ?? 0) + (boost?.plansExisting ?? 0) > 0;
}

/**
 * Starts Beitrag-Push for already-recognized posts without requiring another
 * content Abruf. Retries while candidates are still pending — a previous
 * hard-cap / lease failure must not suppress later successful planning.
 */
export function OrganicBoostAutoPlanner({
  enabled,
  pendingCandidateCount,
}: Props) {
  const router = useRouter();
  const kickoffRef = useRef(false);
  const attemptsRef = useRef(0);
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

    if (kickoffRef.current || attemptsRef.current >= MAX_ATTEMPTS) {
      return;
    }

    let cancelled = false;
    let retryTimer = 0;

    const run = () => {
      if (cancelled || kickoffRef.current) {
        return;
      }
      kickoffRef.current = true;
      attemptsRef.current += 1;

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
            kickoffRef.current = false;
            if (attemptsRef.current < MAX_ATTEMPTS) {
              retryTimer = window.setTimeout(run, RETRY_DELAY_MS);
            }
            return;
          }

          router.refresh();

          if (plansReady(body.organicBoost)) {
            window.sessionStorage.setItem(
              SESSION_KEY,
              JSON.stringify({ at: Date.now(), created: true }),
            );
            setDone(true);
            return;
          }

          // Planner ran but created nothing yet — retry while candidates remain.
          kickoffRef.current = false;
          if (attemptsRef.current < MAX_ATTEMPTS) {
            retryTimer = window.setTimeout(run, RETRY_DELAY_MS);
          }
        } catch {
          if (!cancelled) {
            kickoffRef.current = false;
            if (attemptsRef.current < MAX_ATTEMPTS) {
              retryTimer = window.setTimeout(run, RETRY_DELAY_MS);
            }
          }
        }
      })();
    };

    const startTimer = window.setTimeout(run, START_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      window.clearTimeout(retryTimer);
    };
  }, [done, enabled, pendingCandidateCount, router]);

  return null;
}
