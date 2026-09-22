"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw, Target, Trash2 } from "lucide-react";

import type { ConfirmedPixelView } from "@/components/AutomationOnboardingControls";

type Notice = { tone: "success" | "error"; message: string } | null;

type AccountPixel = { pixelId: string; name: string };

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

function capiStatusLabel(pixel: ConfirmedPixelView) {
  if (pixel.capiViaConnection || pixel.capiProbeStatus === "ok") {
    return "CAPI über Meta-Verbindung aktiv";
  }
  if (pixel.capiProbeStatus === "denied") {
    return "CAPI über Verbindung abgelehnt — Login-Konfiguration prüfen";
  }
  if (pixel.capiProbeStatus === "error") {
    return "CAPI-Prüfung fehlgeschlagen";
  }
  return "CAPI noch nicht über die Verbindung geprüft";
}

export function MetaPixelBinding({ pixels, standalone = false }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [listing, setListing] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [accountPixels, setAccountPixels] = useState<AccountPixel[]>([]);
  const [selectedPixelId, setSelectedPixelId] = useState("");
  const [label, setLabel] = useState("");
  const [customEventType, setCustomEventType] = useState("LEAD");

  async function loadAccountPixels() {
    setListing(true);
    setNotice(null);
    try {
      const result = await apiJson({ action: "list" });
      const next = Array.isArray(result.pixels)
        ? (result.pixels as AccountPixel[]).filter(
            (pixel) =>
              typeof pixel?.pixelId === "string" &&
              /^\d{5,25}$/.test(pixel.pixelId),
          )
        : [];
      setAccountPixels(next);
      setSelectedPixelId((current) => {
        if (current && next.some((pixel) => pixel.pixelId === current)) {
          return current;
        }
        return next[0]?.pixelId ?? "";
      });
      if (typeof result.message === "string" && result.message) {
        setNotice({ tone: "error", message: result.message });
      }
    } catch (error) {
      setAccountPixels([]);
      setSelectedPixelId("");
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Pixel aus der Meta-Verbindung konnten nicht geladen werden.",
      });
    } finally {
      setListing(false);
    }
  }

  useEffect(() => {
    void loadAccountPixels();
    // Customer path: list once from the connected ad account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirmSelectedPixel() {
    if (!selectedPixelId) return;
    setPending(true);
    setNotice(null);
    try {
      const selected = accountPixels.find(
        (pixel) => pixel.pixelId === selectedPixelId,
      );
      const result = await apiJson({
        action: "confirm",
        pixelId: selectedPixelId,
        label: label.trim() || selected?.name || "",
        customEventType: customEventType.trim() || "LEAD",
      });
      setNotice({
        tone: "success",
        message:
          typeof result.message === "string" && result.message
            ? result.message
            : "Pixel bestätigt. Funnel und Freebie übernehmen die ID automatisch (wenn dort noch keine andere steht). Lead-Events melden sie danach selbst an Meta — ohne weiteren Token.",
      });
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Pixel konnte nicht über die Meta-Verbindung bestätigt werden.",
      });
    } finally {
      setPending(false);
    }
  }

  async function probeExisting(pixelId: string) {
    setPending(true);
    setNotice(null);
    try {
      const result = await apiJson({ action: "probe", pixelId });
      const ok = result.capiViaConnection === true || result.capiProbeStatus === "ok";
      setNotice({
        tone: ok ? "success" : "error",
        message:
          typeof result.message === "string" && result.message
            ? result.message
            : ok
              ? "CAPI über die Meta-Verbindung funktioniert."
              : "CAPI über die Meta-Verbindung wurde abgelehnt.",
      });
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "CAPI-Prüfung über die Meta-Verbindung fehlgeschlagen.",
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
            Nur über die bestehende Meta-Verbindung — derselbe Weg wie später
            für echte Kundinnen und Kunden. Adbot listet Pixel am verbundenen
            Werbekonto, prüft CAPI mit dem Connection-Token und bestätigt nur
            bei Erfolg. Funnel und Freebie übernehmen die ID automatisch
            (leere Felder werden befüllt; abweichende manuelle Einträge bleiben
            unangetastet). Wenn jemand den Funnel absendet oder ein Freebie
            bestätigt, meldet Adbot das als Lead an Meta — ohne Events-Manager-Token.
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

      <div className="mt-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-bold text-slate-800">
            Pixel aus dem verbundenen Werbekonto
          </p>
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            disabled={pending || listing}
            onClick={() => void loadAccountPixels()}
            type="button"
          >
            {listing ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Neu laden
          </button>
        </div>

        {listing && accountPixels.length === 0 ? (
          <p className="text-sm text-slate-500">
            Pixel werden über die Meta-Verbindung geladen …
          </p>
        ) : accountPixels.length > 0 ? (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
            {accountPixels.map((pixel) => (
              <li key={pixel.pixelId}>
                <label className="flex cursor-pointer items-start gap-3 px-4 py-3">
                  <input
                    checked={selectedPixelId === pixel.pixelId}
                    className="mt-1"
                    disabled={pending}
                    name="account-pixel"
                    onChange={() => setSelectedPixelId(pixel.pixelId)}
                    type="radio"
                    value={pixel.pixelId}
                  />
                  <span>
                    <span className="block text-sm font-extrabold text-slate-950">
                      {pixel.name || "Meta Pixel"}
                    </span>
                    <span className="mt-0.5 block text-xs font-medium text-slate-500">
                      {pixel.pixelId}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">
            Keine Pixel über die Meta-Verbindung sichtbar.
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
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
        </div>

        <button
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-3 text-sm font-extrabold text-white transition hover:bg-blue-800 disabled:opacity-50"
          disabled={pending || listing || !selectedPixelId}
          onClick={() => void confirmSelectedPixel()}
          type="button"
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Target className="size-4" />
          )}
          CAPI prüfen und Pixel bestätigen
        </button>
      </div>

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
                <p className="mt-0.5 text-xs font-semibold text-slate-700">
                  {capiStatusLabel(pixel)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  disabled={pending}
                  onClick={() => void probeExisting(pixel.pixelId)}
                  type="button"
                >
                  Erneut prüfen
                </button>
                <button
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  disabled={pending}
                  onClick={() => revokePixel(pixel.id)}
                  type="button"
                >
                  <Trash2 className="size-3.5" />
                  Zurückziehen
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-sm text-slate-500">
          Noch kein bestätigtes Pixel. Lead-Canary bleibt gesperrt, bis hier
          eine Pixel-ID über die Meta-Verbindung bestätigt ist.
        </p>
      )}
    </section>
  );
}
