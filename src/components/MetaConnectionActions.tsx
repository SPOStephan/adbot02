"use client";

import { ArrowUpRight, LoaderCircle, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type DisconnectResponse = {
  ok?: boolean;
  error?: string;
};

type Notice = {
  tone: "success" | "error";
  message: string;
};

type MetaConnectionActionsProps = {
  reconnectHref: string;
};

const DISCONNECT_ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.",
  confirmation_required: "Die Trennung wurde nicht bestätigt.",
  disconnect_failed: "Meta konnte nicht sicher getrennt werden. Bitte versuche es erneut.",
};

export function MetaConnectionActions({
  reconnectHref,
}: MetaConnectionActionsProps) {
  const router = useRouter();
  const [disconnectPending, setDisconnectPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function disconnectMeta() {
    const confirmed = window.confirm(
      "Meta wirklich vollständig trennen? Adbot widerruft die Meta-Autorisierung " +
        "und entfernt alle aktuell verbundenen Seiten, Instagram- und Werbekonten. " +
        "Historische Berichtsdaten bleiben erhalten.",
    );

    if (!confirmed) return;

    setDisconnectPending(true);
    setNotice(null);

    try {
      const response = await fetch("/api/connectors/meta/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "disconnect_meta" }),
      });
      const result = (await response.json().catch(() => null)) as DisconnectResponse | null;

      if (!response.ok || !result?.ok) {
        throw new Error(
          DISCONNECT_ERROR_MESSAGES[result?.error ?? ""] ??
            "Meta konnte nicht sicher getrennt werden. Bitte versuche es erneut.",
        );
      }

      setNotice({
        tone: "success",
        message: "Meta wurde vollständig widerrufen und alle verbundenen Assets wurden entfernt.",
      });
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Meta konnte nicht sicher getrennt werden. Bitte versuche es erneut.",
      });
    } finally {
      setDisconnectPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <form action={reconnectHref} method="post">
        <button
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          type="submit"
        >
          Meta neu verbinden
          <ArrowUpRight className="size-4" />
        </button>
      </form>
      <button
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-bold text-red-700 transition hover:border-red-300 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disconnectPending}
        onClick={disconnectMeta}
        type="button"
      >
        {disconnectPending ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <Unplug className="size-4" />
        )}
        {disconnectPending ? "Meta wird getrennt …" : "Meta trennen"}
      </button>
      <p className="text-xs leading-5 text-slate-500">
        Beim Trennen werden die Meta-Autorisierung und alle aktuell verbundenen Assets vollständig entfernt. Historische Berichtsdaten bleiben erhalten.
      </p>
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
