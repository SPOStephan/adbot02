"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Target, Trash2 } from "lucide-react";

import type { ConfirmedPixelView } from "@/components/AutomationOnboardingControls";

type Notice = { tone: "success" | "error"; message: string } | null;

type Props = {
  pixels: ConfirmedPixelView[];
  /** Standalone card (z. B. Traffic-Launch) statt Abschnitt in Autonomie. */
  standalone?: boolean;
};

async function apiJson(
  body: Record<string, unknown>,
): Promise<Record<string, unknown> & { ok?: boolean; message?: string }> {
  const response = await fetch("/api/meta/automation/pixel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
  };
  if (!response.ok || !result.ok) {
    throw new Error(
      typeof result.message === "string"
        ? result.message
        : "Die Pixel-Aktion konnte nicht abgeschlossen werden.",
    );
  }
  return result;
}

export function MetaPixelBinding({ pixels, standalone = false }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [pixelId, setPixelId] = useState("");
  const [label, setLabel] = useState("");
  const [customEventType, setCustomEventType] = useState("LEAD");

  async function confirmPixel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice(null);
    try {
      await apiJson({
        action: "confirm",
        pixelId: pixelId.trim(),
        label: label.trim(),
        customEventType: customEventType.trim() || "LEAD",
      });
      setPixelId("");
      setLabel("");
      setCustomEventType("LEAD");
      setNotice({
        tone: "success",
        message:
          "Pixel bestätigt. Funnel und Freebie übernehmen die ID automatisch (wenn dort noch keine andere steht). CAPI-Token weiterhin im Funnel setzen.",
      });
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Pixel konnte nicht bestätigt werden.",
      });
    } finally {
      setPending(false);
    }
  }

  async function revokePixel(pixelRowId: string) {
    setPending(true);
    setNotice(null);
    try {
      await apiJson({ action: "revoke", pixelRowId });
      setNotice({
        tone: "success",
        message: "Pixel-Bindung zurückgezogen.",
      });
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Pixel konnte nicht zurückgezogen werden.",
      });
    } finally {
      setPending(false);
    }
  }

  const inputClass =
    "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100";

  return (
    <section
      className={
        standalone
          ? "scroll-mt-24 rounded-2xl border border-slate-200 bg-white px-5 py-7 shadow-sm sm:px-7"
          : "scroll-mt-24 border-t border-slate-200 bg-white px-5 py-7 sm:px-7"
      }
      id="meta-pixel"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700">
          <Target className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-blue-700">
            Meta Pixel
          </p>
          <h2 className="mt-1 text-xl font-extrabold tracking-tight text-slate-950">
            Meta Pixel global verbinden
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Einmal für Adbot hinterlegen. Funnel und Freebie übernehmen die ID
            automatisch soft (leere Felder werden befüllt; abweichende manuelle
            Einträge bleiben unangetastet). Lead-Kampagnen nutzen dasselbe Pixel
            — später auch Traffic-/PageView-Messung. CAPI-Token setzt du in den
            Funnel- bzw. Freebie-Einstellungen.
          </p>
        </div>
      </div>

      {notice ? (
        <p
          className={`mt-4 rounded-xl px-4 py-3 text-sm font-semibold ${
            notice.tone === "success"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-rose-50 text-rose-800"
          }`}
          role="status"
        >
          {notice.message}
        </p>
      ) : null}

      <form className="mt-6 grid gap-4 lg:grid-cols-3" onSubmit={confirmPixel}>
        <label className="text-sm font-bold text-slate-800">
          Pixel-ID
          <input
            className={inputClass}
            disabled={pending}
            inputMode="numeric"
            onChange={(event) =>
              setPixelId(event.target.value.replace(/\D/g, "").slice(0, 25))
            }
            placeholder="123456789012345"
            required
            value={pixelId}
          />
        </label>
        <label className="text-sm font-bold text-slate-800">
          Bezeichnung (optional)
          <input
            className={inputClass}
            disabled={pending}
            maxLength={120}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Haupt-Pixel"
            value={label}
          />
        </label>
        <label className="text-sm font-bold text-slate-800">
          Conversion-Event
          <input
            className={inputClass}
            disabled={pending}
            onChange={(event) =>
              setCustomEventType(
                event.target.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 64),
              )
            }
            placeholder="LEAD"
            value={customEventType}
          />
        </label>
        <div className="lg:col-span-3">
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-3 text-sm font-extrabold text-white transition hover:bg-blue-800 disabled:opacity-50"
            disabled={pending || pixelId.length < 5}
            type="submit"
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Target className="size-4" />
            )}
            Pixel bestätigen
          </button>
        </div>
      </form>

      {pixels.length > 0 ? (
        <ul className="mt-6 divide-y divide-slate-200 rounded-xl border border-slate-200">
          {pixels.map((pixel) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              key={pixel.id}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold text-slate-950">
                  {pixel.label || "Meta Pixel"} · {pixel.pixelId}
                </p>
                <p className="mt-0.5 text-xs font-medium text-slate-500">
                  Event {pixel.customEventType}
                  {pixel.customerConfirmedAt
                    ? ` · bestätigt ${new Date(pixel.customerConfirmedAt).toLocaleString("de-DE")}`
                    : null}
                </p>
              </div>
              <button
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                disabled={pending}
                onClick={() => revokePixel(pixel.id)}
                type="button"
              >
                <Trash2 className="size-3.5" />
                Zurückziehen
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-sm text-slate-500">
          Noch kein bestätigtes Pixel. Lead-Canary bleibt gesperrt, bis hier
          eine Pixel-ID bestätigt ist.
        </p>
      )}
    </section>
  );
}
