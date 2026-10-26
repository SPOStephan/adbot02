"use client";

import { useState } from "react";
import { LoaderCircle, Pause, Play } from "lucide-react";
import { useRouter } from "next/navigation";

import type { CampaignStatusTarget } from "@/lib/meta/campaign-status-change";

type Props = {
  platformCampaignId: string;
  campaignName: string;
  target: CampaignStatusTarget;
};

export function MetaCampaignStatusButton({ platformCampaignId, campaignName, target }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pausing = target === "PAUSED";

  async function changeStatus() {
    const question = pausing
      ? `„${campaignName}“ bei Meta pausieren? Die Anzeigen laufen dann nicht mehr, bis du sie fortsetzt.`
      : `„${campaignName}“ bei Meta fortsetzen? Die Anzeigen laufen danach wieder mit dem bisherigen Budget.`;
    if (!window.confirm(question)) return;

    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/meta/automation/campaign-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformCampaignId, status: target }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: string;
        message?: string;
      };
      if (!response.ok || !result.ok) {
        throw new Error(
          typeof result.message === "string"
            ? result.message
            : "Die Statusänderung ist fehlgeschlagen.",
        );
      }
      if (result.status === "QUEUED") {
        setNotice("Die Änderung ist vorgemerkt und wird in Kürze an Meta übertragen.");
      } else {
        setNotice(pausing ? "Die Kampagne ist pausiert." : "Die Kampagne läuft wieder.");
      }
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Die Statusänderung ist fehlgeschlagen.",
      );
    } finally {
      setPending(false);
    }
  }

  const Icon = pending ? LoaderCircle : pausing ? Pause : Play;
  return (
    <div className="mb-3">
      <button
        className={
          pausing
            ? "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
            : "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
        }
        disabled={pending}
        onClick={changeStatus}
        type="button"
      >
        <Icon aria-hidden="true" className={pending ? "size-4 animate-spin" : "size-4"} />
        {pending
          ? pausing
            ? "Wird pausiert …"
            : "Wird fortgesetzt …"
          : pausing
            ? "Kampagne pausieren"
            : "Kampagne fortsetzen"}
      </button>
      {notice ? (
        <p className="mt-2 text-xs font-semibold text-emerald-700" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-xs font-semibold text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
