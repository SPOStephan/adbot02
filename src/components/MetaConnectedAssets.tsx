"use client";

import { ArrowUpRight, Check, LoaderCircle, X } from "lucide-react";
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

const SELECT_ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.",
  confirmation_required: "Die Auswahl wurde nicht bestätigt.",
  invalid_asset: "Dieses Werbekonto konnte nicht erkannt werden.",
  not_found: "Das Werbekonto ist nicht mehr mit Adbot verbunden.",
  select_failed:
    "Das Werbekonto konnte nicht als aktiv gesetzt werden. Bitte versuche es erneut.",
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

  const adAccounts = assets.filter((asset) => asset.assetType === "ad_account");
  const needsAdAccountPick =
    adAccounts.length > 1 &&
    !adAccounts.some((asset) => asset.selectedForAds);

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

  async function selectAdAccount(asset: MetaConnectedAssetView) {
    if (!asset.selectableForAds || asset.selectedForAds || pendingId) {
      return;
    }

    setPendingId(asset.id);
    setNotice(null);

    try {
      const response = await fetch(
        "/api/connectors/meta/assets/select-ad-account",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmation: "select_meta_ad_account",
            assetId: asset.id,
          }),
        },
      );
      const result = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        label?: string;
      } | null;

      if (!response.ok || !result?.ok) {
        throw new Error(
          SELECT_ERROR_MESSAGES[result?.error ?? ""]
            ?? SELECT_ERROR_MESSAGES.select_failed,
        );
      }

      setNotice({
        tone: "success",
        message: `„${result.label ?? asset.label}“ ist jetzt das aktive Werbekonto für Ads.`,
      });
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : SELECT_ERROR_MESSAGES.select_failed,
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
          hier alles, was Adbot nicht nutzen soll — ohne den Connect-Dialog erneut
          zu öffnen. Mehrere Werbekonten sind für den Beitragsabruf unkritisch;
          für Ads wählst du unten das aktive Konto.
        </p>
      ) : null}
      {needsAdAccountPick ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950 break-words">
          Mehrere Werbekonten sind verbunden. Wähle eines als aktiv für Ads —
          der Beitragsabruf läuft unabhängig weiter.
        </p>
      ) : null}
      <div className="flex min-w-0 flex-wrap gap-2 text-xs font-semibold text-slate-600">
        {assets.map((asset) => {
          const busy = pendingId === asset.id;
          const isAd = asset.assetType === "ad_account";
          return (
            <span
              className={`inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full py-1.5 pl-3 pr-1.5 ${
                asset.selectedForAds
                  ? "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300"
                  : "bg-slate-100"
              }`}
              key={asset.id}
            >
              <span className="min-w-0 truncate">{asset.label}</span>
              {asset.selectedForAds ? (
                <span className="shrink-0 rounded-full bg-emerald-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  Ads aktiv
                </span>
              ) : null}
              {isAd && asset.selectableForAds && !asset.selectedForAds ? (
                <button
                  aria-label={`${asset.label} als aktives Werbekonto für Ads wählen`}
                  className="inline-flex min-h-7 items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200 transition hover:bg-blue-50 hover:text-blue-800 hover:ring-blue-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={Boolean(pendingId)}
                  onClick={() => {
                    void selectAdAccount(asset);
                  }}
                  type="button"
                >
                  {busy ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                  Für Ads
                </button>
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
                  {busy && !asset.selectableForAds ? (
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
