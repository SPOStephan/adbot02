"use client";

import { useState } from "react";
import Link from "next/link";
import { LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

type Props = {
  draftId: string;
};

export function MetaCampaignDraftActions({ draftId }: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteDraft() {
    if (
      !window.confirm(
        "Diesen Kampagnenentwurf wirklich löschen? Noch nicht gestartete Budgetreservierungen dieses Entwurfs werden ebenfalls entfernt.",
      )
    ) {
      return;
    }

    setDeleting(true);
    setError(null);
    try {
      const response = await fetch("/api/meta/automation/campaign-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId, status: "ARCHIVED" }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !result.ok) {
        throw new Error(
          typeof result.message === "string"
            ? result.message
            : "Der Entwurf konnte nicht gelöscht werden.",
        );
      }
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Der Entwurf konnte nicht gelöscht werden.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <Link
          className="inline-flex min-h-10 items-center justify-center rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white hover:bg-blue-800"
          href={`/dashboard/traffic-launch?draftId=${encodeURIComponent(draftId)}`}
        >
          Bearbeitung fortsetzen
        </Link>
        <button
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={deleting}
          onClick={deleteDraft}
          type="button"
        >
          {deleting ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Trash2 aria-hidden="true" className="size-4" />
          )}
          {deleting ? "Wird gelöscht …" : "Entwurf löschen"}
        </button>
      </div>
      {error ? (
        <p className="mt-2 text-xs font-semibold text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
