"use client";

import { useState } from "react";
import { Copy, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";

type Props = {
  platformCampaignId: string;
};

export function MetaCampaignDuplicateButton({ platformCampaignId }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function duplicate() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/meta/automation/campaign-draft/duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformCampaignId }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        draftId?: string;
        message?: string;
      };
      if (!response.ok || !result.ok || typeof result.draftId !== "string") {
        throw new Error(
          typeof result.message === "string"
            ? result.message
            : "Die Kampagne konnte nicht dupliziert werden.",
        );
      }
      router.push(
        `/dashboard/traffic-launch?draftId=${encodeURIComponent(result.draftId)}&kopie=1`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Die Kampagne konnte nicht dupliziert werden.",
      );
      setPending(false);
    }
  }

  return (
    <div className="mb-3">
      <button
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={pending}
        onClick={duplicate}
        type="button"
      >
        {pending ? (
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <Copy aria-hidden="true" className="size-4" />
        )}
        {pending ? "Wird dupliziert …" : "Als Vorlage duplizieren"}
      </button>
      <p className="mt-1 text-xs text-slate-500">
        Legt einen neuen Entwurf mit denselben Texten, Bildern und Einstellungen an.
        Ziel-URL und Zielgebiet passt du vor dem Start an. Die laufende Kampagne
        bleibt unverändert.
      </p>
      {error ? (
        <p className="mt-2 text-xs font-semibold text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
