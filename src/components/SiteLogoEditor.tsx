"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Trash2, Upload } from "lucide-react";

import { SITE_FAVICON_RECOMMENDATIONS } from "@/lib/site-branding/recommendations";
import { SITE_LOGO_RECOMMENDATIONS } from "@/lib/site-branding/recommendations";
import type { LogoVariant, SiteBranding } from "@/lib/site-branding/types";

type Props = {
  branding: SiteBranding;
};

const VARIANTS: Array<{
  variant: LogoVariant;
  previewTone: "light" | "dark";
  meta:
    | typeof SITE_LOGO_RECOMMENDATIONS.onLight
    | typeof SITE_LOGO_RECOMMENDATIONS.onDark;
}> = [
  {
    variant: "on_light",
    previewTone: "light",
    meta: SITE_LOGO_RECOMMENDATIONS.onLight,
  },
  {
    variant: "on_dark",
    previewTone: "dark",
    meta: SITE_LOGO_RECOMMENDATIONS.onDark,
  },
];

export function SiteLogoEditor({ branding: initial }: Props) {
  const router = useRouter();
  const [branding, setBranding] = useState(initial);
  const [pendingVariant, setPendingVariant] = useState<LogoVariant | null>(
    null,
  );
  const [faviconPending, setFaviconPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const lightInputRef = useRef<HTMLInputElement>(null);
  const darkInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  function inputRef(variant: LogoVariant) {
    return variant === "on_light" ? lightInputRef : darkInputRef;
  }

  async function upload(variant: LogoVariant, file: File | null) {
    if (!file) return;
    setPendingVariant(variant);
    setNotice(null);
    try {
      const form = new FormData();
      form.set("variant", variant);
      form.set("file", file);
      const response = await fetch("/api/site-branding/logo", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        branding?: SiteBranding;
      };
      if (!response.ok || payload.ok !== true || !payload.branding) {
        throw new Error(payload.message ?? "Upload fehlgeschlagen.");
      }
      setBranding(payload.branding);
      setNotice("Logo gespeichert. Öffentliche Seiten nutzen es sofort.");
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Upload fehlgeschlagen.",
      );
    } finally {
      setPendingVariant(null);
      const ref = inputRef(variant).current;
      if (ref) ref.value = "";
    }
  }

  async function remove(variant: LogoVariant) {
    setPendingVariant(variant);
    setNotice(null);
    try {
      const response = await fetch("/api/site-branding/logo", {
        method: "DELETE",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ variant }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        branding?: SiteBranding;
      };
      if (!response.ok || payload.ok !== true || !payload.branding) {
        throw new Error(payload.message ?? "Löschen fehlgeschlagen.");
      }
      setBranding(payload.branding);
      setNotice("Logo entfernt. Fallback (Icon + Adbot.one) ist aktiv.");
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Löschen fehlgeschlagen.",
      );
    } finally {
      setPendingVariant(null);
    }
  }

  async function uploadFavicon(file: File | null) {
    if (!file) return;
    setFaviconPending(true);
    setNotice(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/site-branding/favicon", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        branding?: SiteBranding;
      };
      if (!response.ok || payload.ok !== true || !payload.branding) {
        throw new Error(payload.message ?? "Upload fehlgeschlagen.");
      }
      setBranding(payload.branding);
      setNotice("Favicon gespeichert. Browser-Tab aktualisiert nach Reload.");
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Upload fehlgeschlagen.",
      );
    } finally {
      setFaviconPending(false);
      if (faviconInputRef.current) faviconInputRef.current.value = "";
    }
  }

  async function removeFavicon() {
    setFaviconPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/site-branding/favicon", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        branding?: SiteBranding;
      };
      if (!response.ok || payload.ok !== true || !payload.branding) {
        throw new Error(payload.message ?? "Löschen fehlgeschlagen.");
      }
      setBranding(payload.branding);
      setNotice("Favicon entfernt.");
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Löschen fehlgeschlagen.",
      );
    } finally {
      setFaviconPending(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="text-lg font-extrabold text-slate-950">Favicon</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
          Icon im Browser-Tab für Adbot.one. {SITE_FAVICON_RECOMMENDATIONS.tip}
        </p>
        <dl className="mt-4 grid gap-2 rounded-xl bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600 sm:grid-cols-2">
          <div>
            <dt className="text-slate-400">Empfohlene Größe</dt>
            <dd className="mt-0.5 text-slate-800">
              {SITE_FAVICON_RECOMMENDATIONS.sizeLabel}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">Format</dt>
            <dd className="mt-0.5 text-slate-800">
              {SITE_FAVICON_RECOMMENDATIONS.formatsLabel},{" "}
              {SITE_FAVICON_RECOMMENDATIONS.maxBytesLabel}
            </dd>
          </div>
        </dl>
        <div className="mt-4 flex min-h-20 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4">
          {branding.faviconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt="Favicon-Vorschau"
              className="size-10 object-contain"
              src={branding.faviconUrl}
            />
          ) : (
            <p className="text-xs font-bold text-slate-400">Noch kein Favicon</p>
          )}
        </div>
        <input
          accept="image/png,image/jpeg,image/webp,image/x-icon,.ico"
          className="hidden"
          onChange={(event) =>
            void uploadFavicon(event.target.files?.[0] ?? null)
          }
          ref={faviconInputRef}
          type="file"
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-extrabold text-white disabled:opacity-50"
            disabled={faviconPending}
            onClick={() => faviconInputRef.current?.click()}
            type="button"
          >
            <Upload className="size-3.5" />
            {faviconPending
              ? "Lädt …"
              : branding.faviconUrl
                ? "Ersetzen"
                : "Hochladen"}
          </button>
          {branding.faviconUrl ? (
            <button
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              disabled={faviconPending}
              onClick={() => void removeFavicon()}
              type="button"
            >
              <Trash2 className="size-3.5" />
              Entfernen
            </button>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="text-lg font-extrabold text-slate-950">Site-Logo</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
          Zwei Varianten: die Seite wählt automatisch nach Hintergrund.
          Landingpage und Login sind dunkel → Dark-Mode-Logo; Dashboard und
          Rechtstexte sind hell → Hell-Modus-Logo.
        </p>

        <dl className="mt-4 grid gap-2 rounded-xl bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600 sm:grid-cols-2">
          <div>
            <dt className="text-slate-400">Empfohlene Größe</dt>
            <dd className="mt-0.5 text-slate-800">
              {SITE_LOGO_RECOMMENDATIONS.widthLabel},{" "}
              {SITE_LOGO_RECOMMENDATIONS.heightLabel}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">Format</dt>
            <dd className="mt-0.5 text-slate-800">
              {SITE_LOGO_RECOMMENDATIONS.formatsLabel},{" "}
              {SITE_LOGO_RECOMMENDATIONS.maxBytesLabel}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-slate-400">Darstellung</dt>
            <dd className="mt-0.5 text-slate-800">
              Navigationshöhe ca. {SITE_LOGO_RECOMMENDATIONS.displayHeightPx}{" "}
              px — bitte @2× liefern (Retina). Transparenter Hintergrund
              empfohlen.
            </dd>
          </div>
        </dl>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {VARIANTS.map(({ variant, previewTone, meta }) => {
          const url =
            variant === "on_light"
              ? branding.logoOnLightUrl
              : branding.logoOnDarkUrl;
          const busy = pendingVariant === variant;
          return (
            <article
              className="rounded-2xl border border-slate-200 bg-white p-5"
              key={variant}
            >
              <div className="flex items-start gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-slate-900 text-white">
                  <ImagePlus className="size-5" />
                </span>
                <div>
                  <h3 className="text-base font-extrabold text-slate-950">
                    {meta.title}
                  </h3>
                  <p className="mt-0.5 text-xs font-semibold text-slate-500">
                    {meta.subtitle}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">{meta.tip}</p>

              <div
                className={`mt-4 flex min-h-28 items-center justify-center rounded-xl border border-dashed px-4 ${
                  previewTone === "dark"
                    ? "border-slate-700 bg-slate-950"
                    : "border-slate-200 bg-slate-50"
                }`}
              >
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={`Vorschau ${meta.title}`}
                    className="h-10 max-w-[12rem] w-auto object-contain"
                    src={url}
                  />
                ) : (
                  <p
                    className={`text-xs font-bold ${
                      previewTone === "dark" ? "text-slate-400" : "text-slate-400"
                    }`}
                  >
                    Noch kein Logo — Fallback aktiv
                  </p>
                )}
              </div>

              <input
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) =>
                  void upload(variant, event.target.files?.[0] ?? null)
                }
                ref={inputRef(variant)}
                type="file"
              />

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-extrabold text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={() => inputRef(variant).current?.click()}
                  type="button"
                >
                  <Upload className="size-3.5" />
                  {busy ? "Lädt …" : url ? "Ersetzen" : "Hochladen"}
                </button>
                {url ? (
                  <button
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void remove(variant)}
                    type="button"
                  >
                    <Trash2 className="size-3.5" />
                    Entfernen
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {notice ? (
        <p className="text-sm font-semibold text-slate-700" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
