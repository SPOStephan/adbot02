"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type MetaAdAccountOption = {
  id: string;
  label: string;
  selectedForAds: boolean;
};

type Notice = {
  tone: "success" | "error";
  message: string;
};

const SELECT_ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.",
  confirmation_required: "Die Auswahl wurde nicht bestätigt.",
  invalid_asset: "Dieses Werbekonto konnte nicht erkannt werden.",
  not_found: "Das Werbekonto ist nicht mehr mit Adbot verbunden.",
  select_failed:
    "Das Werbekonto konnte nicht als aktiv gesetzt werden. Bitte versuche es erneut.",
};

type Props = {
  accounts: MetaAdAccountOption[];
  /** Compact embed (e.g. inside an alert). Default: full section. */
  compact?: boolean;
};

export function MetaAdAccountPicker({ accounts, compact = false }: Props) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  if (!accounts.length) {
    return null;
  }

  const needsPick =
    accounts.length > 1 && !accounts.some((account) => account.selectedForAds);
  const canSwitch = accounts.length > 1;

  async function selectAdAccount(account: MetaAdAccountOption) {
    if (!canSwitch || account.selectedForAds || pendingId) {
      return;
    }

    setPendingId(account.id);
    setNotice(null);

    try {
      const response = await fetch(
        "/api/connectors/meta/assets/select-ad-account",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmation: "select_meta_ad_account",
            assetId: account.id,
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
        message: `„${result.label ?? account.label}“ ist jetzt das aktive Werbekonto für Ads.`,
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

  const list = (
    <ul className="space-y-2">
      {accounts.map((account) => {
        const busy = pendingId === account.id;
        const selected = account.selectedForAds;
        return (
          <li key={account.id}>
            <button
              aria-pressed={selected}
              className={`flex w-full min-w-0 items-center gap-3 rounded-xl border px-4 py-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60 ${
                selected
                  ? "border-emerald-400 bg-emerald-50 text-emerald-950"
                  : canSwitch
                    ? "border-slate-200 bg-white text-slate-900 hover:border-blue-300 hover:bg-blue-50"
                    : "border-slate-200 bg-slate-50 text-slate-800"
              }`}
              disabled={!canSwitch || selected || Boolean(pendingId)}
              onClick={() => {
                void selectAdAccount(account);
              }}
              type="button"
            >
              <span
                aria-hidden
                className={`grid size-8 shrink-0 place-items-center rounded-full ${
                  selected
                    ? "bg-emerald-700 text-white"
                    : "bg-slate-200 text-slate-600"
                }`}
              >
                {busy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">
                  {account.label.replace(/^Werbekonto:\s*/i, "")}
                </span>
                <span className="mt-0.5 block text-xs font-semibold text-slate-500">
                  {selected
                    ? "Aktiv für Ads und Kampagnenabruf"
                    : canSwitch
                      ? "Tippen zum Aktivieren für Ads"
                      : "Einziges verbundenes Werbekonto"}
                </span>
              </span>
              {selected ? (
                <span className="shrink-0 rounded-full bg-emerald-700 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                  Aktiv
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );

  if (compact) {
    return (
      <div className="mt-3 space-y-2">
        {list}
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
      </div>
    );
  }

  return (
    <section
      aria-labelledby="meta-ad-account-picker-title"
      className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
      id="werbekonto"
    >
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
        Ads-Zielkonto
      </p>
      <h2
        className="mt-2 text-lg font-extrabold text-slate-900"
        id="meta-ad-account-picker-title"
      >
        Aktives Werbekonto
      </h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
        Meta liefert oft mehrere Werbekonten mit. Der Beitragsabruf läuft
        unabhängig — für Kampagnen und Schaltungen wählst du hier das Konto.
      </p>
      {needsPick ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">
          Bitte eines der Konten unten auswählen. Ohne Auswahl bleiben Ads und
          Kampagnenabruf pausiert.
        </p>
      ) : null}
      <div className="mt-4">{list}</div>
      {notice ? (
        <p
          aria-live="polite"
          className={`mt-3 rounded-lg px-3 py-2 text-xs font-semibold leading-5 ${
            notice.tone === "success"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-red-50 text-red-800"
          }`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      ) : null}
    </section>
  );
}
