"use client";

import { ArrowUpRight, LoaderCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export type MetaConnectedAssetView = {
  id: string;
  assetType: "facebook_page" | "instagram_account" | "ad_account";
  label: string;
  removable: boolean;
  /** True when this Werbekonto is the active Ads target. */
  selectedForAds?: boolean;
  /** True when the user can pick this Werbekonto for Ads. */
  selectableForAds?: boolean;
};

type Notice = {
  tone: "success" | "error";
  message: string;
};

const PRUNE_ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.",
  confirmation_required: "Die Entfernung wurde nicht bestätigt.",
  invalid_asset: "Dieses Asset konnte nicht erkannt werden.",
  not_found: "Das Asset ist nicht mehr mit Adbot verbunden.",
  last_of_type:
    "Mindestens ein Asset dieses Typs muss verbunden bleiben. Trenne Meta vollständig, wenn du neu auswählen willst.",
  prune_failed: "Das Asset konnte nicht entfernt werden. Bitte versuche es erneut.",
};

type MetaConnectedAssetsProps = {
  assets: MetaConnectedAssetView[];
  showExtraHint: boolean;
  extendHref?: string;
};

const EXTEND_CONFIRM_MESSAGE =
  "Adbot öffnet den Meta-Dialog zum Erweitern.\n\n" +
  "Bereits verbundene Seiten und Konten bleiben erhalten.\n" +
  "Wähle im Dialog die ZUSÄTZLICHEN Assets aus deinem Portfolio.\n\n" +
  "Kein Widerruf, kein Neuverbinden der bestehenden Assets.";

export function MetaConnectedAssets({
  assets,
  showExtraHint,
  extendHref,
}: MetaConnectedAssetsProps) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const hasAdAccounts = assets.some(
    (asset) => asset.assetType === "ad_account",
  );

  async function pruneAsset(asset: MetaConnectedAssetView) {
    if (!asset.removable || pendingId) {
      return;
    }

    const confirmed = window.confirm(
      `„${asset.label}“ aus Adbot entfernen?\n\n` +
        "Adbot lädt danach keine neuen Beiträge und Werbedaten mehr aus diesem Asset. " +
        "Die Meta-Autorisierung selbst bleibt bestehen.",
    );

    if (!confirmed) {
      return;
    }

    setPendingId(asset.id);
    setNotice(null);

    try {
      const response = await fetch("/api/connectors/meta/assets/prune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmation: "prune_meta_asset",
          assetId: asset.id,
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;

      if (!response.ok || !result?.ok) {
        throw new Error(
          PRUNE_ERROR_MESSAGES[result?.error ?? ""]
            ?? PRUNE_ERROR_MESSAGES.prune_failed,
        );
      }

      setNotice({
        tone: "success",
        message: `„${asset.label}“ wurde aus Adbot entfernt und wird nicht mehr synchronisiert.`,
      });
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : PRUNE_ERROR_MESSAGES.prune_failed,
      });
    } finally {
      setPendingId(null);
    }
  }

  if (!assets.length) {
    return null;
  }

  return (
    <div className="mt-5 min-w-0 space-y-3">
      {showExtraHint ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950 break-words">
          Meta hat möglicherweise zuvor verbundene Assets mitgeliefert. Entferne
          hier alles, was Adbot nicht nutzen soll. Das aktive Werbekonto für Ads
          wählst du im Bereich{" "}
          <a
            className="font-bold text-amber-950 underline underline-offset-2"
            href="#werbekonto"
          >
            Aktives Werbekonto
          </a>
          .
        </p>
      ) : null}
      <div className="flex min-w-0 flex-wrap gap-2 text-xs font-semibold text-slate-600">
        {assets.map((asset) => {
          const busy = pendingId === asset.id;
          return (
            <span
              className={`inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full py-1.5 pl-3 pr-1.5 ${
                asset.selectedForAds
                  ? "bg-emerald-100 text-emerald-900"
                  : "bg-slate-100"
              }`}
              key={asset.id}
            >
              <span className="min-w-0 truncate">{asset.label}</span>
              {asset.selectedForAds ? (
                <span className="shrink-0 rounded-full bg-emerald-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  Ads
                </span>
              ) : null}
              {asset.removable ? (
                <button
                  aria-label={`${asset.label} aus Adbot entfernen`}
                  className="inline-flex size-7 items-center justify-center rounded-full text-slate-500 transition hover:bg-white hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={Boolean(pendingId)}
                  onClick={() => {
                    void pruneAsset(asset);
                  }}
                  type="button"
                >
                  {busy ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <X className="size-3.5" />
                  )}
                </button>
              ) : null}
            </span>
          );
        })}
      </div>
      {hasAdAccounts ? (
        <p className="text-xs leading-5 text-slate-500">
          Ads-Zielkonto wechseln:{" "}
          <a
            className="font-bold text-blue-700 underline-offset-2 hover:underline"
            href="#werbekonto"
          >
            Aktives Werbekonto
          </a>
        </p>
      ) : null}
      {notice ? (
        <p
          aria-live="polite"
          className={`rounded-lg px-3 py-2 text-xs font-semibold leading-5 ${
            notice.tone === "success"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-red-50 text-red-800"
          }`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      ) : null}
      {extendHref ? (
        <form
          action={extendHref}
          className="pt-1"
          method="post"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            if (!window.confirm(EXTEND_CONFIRM_MESSAGE)) {
              event.preventDefault();
            }
          }}
        >
          <button
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            type="submit"
          >
            Weitere Seiten oder Konten hinzufügen
            <ArrowUpRight className="size-3.5" />
          </button>
        </form>
      ) : null}
    </div>
  );
}
