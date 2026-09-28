"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  MetaCampaignDraftPayload,
  MetaCampaignDraftView,
} from "@/lib/meta/campaign-draft-types";

export type CampaignDraftSaveState = "idle" | "saving" | "saved" | "error";

type SaveResponse = {
  ok?: boolean;
  message?: string;
  draftId?: string;
  revision?: number;
  savedAt?: string;
};

export function useCampaignDraftAutosave(input: {
  enabled: boolean;
  initialDraft?: MetaCampaignDraftView | null;
  payload: MetaCampaignDraftPayload;
}) {
  const [draftId, setDraftId] = useState<string | null>(input.initialDraft?.id ?? null);
  const [state, setState] = useState<CampaignDraftSaveState>(
    input.initialDraft ? "saved" : "idle",
  );
  const [savedAt, setSavedAt] = useState<string | null>(input.initialDraft?.updatedAt ?? null);
  const draftIdRef = useRef(draftId);
  const revisionRef = useRef(input.initialDraft?.revision ?? 0);
  const latestPayloadRef = useRef(input.payload);
  const queueRef = useRef<Promise<SaveResponse>>(Promise.resolve({ ok: true }));
  const latestRequestedRef = useRef(0);

  useEffect(() => {
    latestPayloadRef.current = input.payload;
  }, [input.payload]);

  const saveNow = useCallback((): Promise<SaveResponse> => {
    if (!input.enabled) return Promise.resolve({ ok: true });
    const requested = latestRequestedRef.current + 1;
    latestRequestedRef.current = requested;
    setState("saving");

    const perform = async (): Promise<SaveResponse> => {
      const revision = revisionRef.current + 1;
      revisionRef.current = revision;
      const response = await fetch("/api/meta/automation/campaign-draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: draftIdRef.current,
          revision,
          payload: latestPayloadRef.current,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as SaveResponse;
      if (
        !response.ok ||
        !result.ok ||
        typeof result.draftId !== "string" ||
        typeof result.revision !== "number" ||
        !Number.isSafeInteger(result.revision)
      ) {
        throw new Error(result.message ?? "Der Kampagnenentwurf konnte nicht gespeichert werden.");
      }
      draftIdRef.current = result.draftId;
      revisionRef.current = Math.max(revisionRef.current, result.revision);
      setDraftId(result.draftId);
      if (requested === latestRequestedRef.current) {
        setSavedAt(typeof result.savedAt === "string" ? result.savedAt : new Date().toISOString());
        setState("saved");
      }
      return result;
    };

    const queued = queueRef.current.then(perform, perform);
    queueRef.current = queued.catch(() => {
      if (requested === latestRequestedRef.current) setState("error");
      return { ok: false };
    });
    return queued;
  }, [input.enabled]);

  const payloadJson = JSON.stringify(input.payload);
  useEffect(() => {
    if (!input.enabled) return;
    const timer = window.setTimeout(() => {
      void saveNow().catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [input.enabled, payloadJson, saveNow]);

  const markLaunched = useCallback(async () => {
    if (!input.enabled) return;
    const saved = await saveNow();
    const id = saved.draftId ?? draftIdRef.current;
    if (!id) throw new Error("Der Kampagnenentwurf hat keine ID.");
    const response = await fetch("/api/meta/automation/campaign-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId: id, status: "LAUNCHED" }),
    });
    const result = (await response.json().catch(() => ({}))) as SaveResponse;
    if (!response.ok || !result.ok) {
      throw new Error(result.message ?? "Der Entwurf konnte nicht abgeschlossen werden.");
    }
  }, [input.enabled, saveNow]);

  const resetDraft = useCallback(() => {
    draftIdRef.current = null;
    revisionRef.current = 0;
    latestRequestedRef.current = 0;
    queueRef.current = Promise.resolve({ ok: true });
    setDraftId(null);
    setSavedAt(null);
    setState("idle");
  }, []);

  return { draftId, markLaunched, resetDraft, saveNow, savedAt, state };
}
