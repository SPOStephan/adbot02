"use client";

import {
  ImagePlus,
  Loader2,
  Lock,
  Sparkles,
  Star,
  Trash2,
  Unlock,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { formatLabelForDimensions } from "@/lib/media-library/meta-formats";
import { parseAssetUploadResponse } from "@/lib/media-library/parse-upload-response";

export type MediaLibraryAssetView = {
  id: string;
  originalFilename: string;
  width: number | null;
  height: number | null;
  sourceType: string;
  status: string;
  assetRole: string;
  trainingStatus: string;
  metaImageHashPresent: boolean;
  createdAt: string;
  label?: string | null;
};

type BrandProfileOption = {
  id: string;
  brandName: string;
};

type GenerationConfig = {
  configured: boolean;
  providerKey: string | null;
  defaultModelId: string | null;
  modelAllowlist: string[];
};

export function MediaLibraryClient({
  assets: initialAssets,
  brandProfiles,
  metaConnected,
  loadError = null,
}: {
  assets: MediaLibraryAssetView[];
  brandProfiles: BrandProfileOption[];
  metaConnected: boolean;
  /** Set when the server list query failed — never imply an empty library. */
  loadError?: string | null;
}) {
  const router = useRouter();
  const [assets, setAssets] = useState(initialAssets);
  const [brandProfileId, setBrandProfileId] = useState(
    brandProfiles[0]?.id ?? "",
  );
  const [pending, setPending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [genConfig, setGenConfig] = useState<GenerationConfig | null>(null);
  const [genMode, setGenMode] = useState<"free" | "locked_photo">("free");
  const [genPrompt, setGenPrompt] = useState("");
  const [genModelId, setGenModelId] = useState("");
  const [genLockedAssetId, setGenLockedAssetId] = useState("");
  const [genStyleIds, setGenStyleIds] = useState<string[]>([]);
  const [genPending, setGenPending] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genMessage, setGenMessage] = useState<string | null>(null);

  useEffect(() => {
    setAssets(initialAssets);
  }, [initialAssets]);

  useEffect(() => {
    if (!brandProfileId && brandProfiles[0]?.id) {
      setBrandProfileId(brandProfiles[0].id);
    }
  }, [brandProfileId, brandProfiles]);

  useEffect(() => {
    if (!metaConnected) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          "/api/meta/automation/creative-assets/config",
          { credentials: "same-origin" },
        );
        const json = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          configured?: boolean;
          providerKey?: string | null;
          defaultModelId?: string | null;
          modelAllowlist?: string[];
        };
        if (cancelled || !response.ok || !json.ok) return;
        const allowlist = Array.isArray(json.modelAllowlist)
          ? json.modelAllowlist
          : [];
        const defaultModelId =
          typeof json.defaultModelId === "string" ? json.defaultModelId : "";
        setGenConfig({
          configured: Boolean(json.configured),
          providerKey:
            typeof json.providerKey === "string" ? json.providerKey : null,
          defaultModelId: defaultModelId || null,
          modelAllowlist: allowlist,
        });
        setGenModelId(defaultModelId || allowlist[0] || "");
      } catch {
        // Config is optional for upload/library; generate section shows offline state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [metaConnected]);

  const lockedPhotoOptions = useMemo(
    () =>
      assets.filter(
        (asset) =>
          asset.assetRole === "LOCKED_PHOTO" &&
          asset.status === "READY",
      ),
    [assets],
  );

  const styleReferenceOptions = useMemo(
    () =>
      assets.filter(
        (asset) =>
          asset.status === "READY" &&
          (asset.trainingStatus === "marked_good" ||
            asset.trainingStatus === "performance_winner" ||
            asset.assetRole === "STYLE_REFERENCE"),
      ),
    [assets],
  );

  async function onUpload(file: File | undefined) {
    if (!file) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("generateMetaCrops", "1");
      if (brandProfileId) {
        body.set("brandProfileId", brandProfileId);
      }
      const response = await fetch("/api/meta/automation/asset-upload", {
        method: "POST",
        credentials: "same-origin",
        body,
      });
      const json = await parseAssetUploadResponse(response);
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Upload fehlgeschlagen.");
      }
      setMessage(
        "Creative in deine Media Library übernommen. Du kannst es später für Meta-Launches nutzen.",
      );
      router.refresh();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Upload fehlgeschlagen.",
      );
    } finally {
      setPending(false);
    }
  }

  async function onDelete(assetId: string) {
    if (deletingId) return;
    const confirmed = window.confirm(
      "Dieses Creative wirklich löschen? Zugehörige Auto-Zuschnitte werden mit entfernt.",
    );
    if (!confirmed) return;

    setDeletingId(assetId);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/media-library/asset", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        revokedAssetIds?: string[];
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Löschen fehlgeschlagen.");
      }
      const revoked = new Set(result.revokedAssetIds ?? [assetId]);
      setAssets((previous) => previous.filter((asset) => !revoked.has(asset.id)));
      setMessage("Creative gelöscht.");
      router.refresh();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Löschen fehlgeschlagen.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  async function onToggleTraining(asset: MediaLibraryAssetView) {
    if (actionId) return;
    const next =
      asset.trainingStatus === "marked_good" ? "none" : "marked_good";
    setActionId(asset.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/media-library/training-status", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: asset.id, trainingStatus: next }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Markierung fehlgeschlagen.");
      }
      setAssets((previous) =>
        previous.map((row) =>
          row.id === asset.id ? { ...row, trainingStatus: next } : row,
        ),
      );
      setMessage(
        next === "marked_good"
          ? "Als gutes Beispiel markiert."
          : "Markierung entfernt.",
      );
      router.refresh();
    } catch (markError) {
      setError(
        markError instanceof Error
          ? markError.message
          : "Markierung fehlgeschlagen.",
      );
    } finally {
      setActionId(null);
    }
  }

  async function onToggleLocked(asset: MediaLibraryAssetView) {
    if (actionId) return;
    const lock = asset.assetRole !== "LOCKED_PHOTO";
    setActionId(asset.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/media-library/locked-photo", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: asset.id, locked: lock }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        assetRole?: string;
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Locked-Photo-Status fehlgeschlagen.");
      }
      const nextRole =
        typeof result.assetRole === "string"
          ? result.assetRole
          : lock
            ? "LOCKED_PHOTO"
            : "UPLOAD_EDITABLE";
      setAssets((previous) =>
        previous.map((row) =>
          row.id === asset.id ? { ...row, assetRole: nextRole } : row,
        ),
      );
      setMessage(
        lock
          ? "Als Locked Photo markiert (wird unverändert eingebettet)."
          : "Locked Photo aufgehoben.",
      );
      router.refresh();
    } catch (lockError) {
      setError(
        lockError instanceof Error
          ? lockError.message
          : "Locked-Photo-Status fehlgeschlagen.",
      );
    } finally {
      setActionId(null);
    }
  }

  async function onGenerate() {
    if (genPending) return;
    setGenPending(true);
    setGenError(null);
    setGenMessage(null);
    try {
      if (!brandProfileId) {
        throw new Error("Für KI-Generierung brauchst du ein aktives Brand-Profil.");
      }
      if (!genConfig?.configured || !genConfig.providerKey || !genModelId) {
        throw new Error(
          "KI-Generierung ist noch nicht konfiguriert (Provider/Modell).",
        );
      }
      if (genMode === "locked_photo" && !genLockedAssetId) {
        throw new Error("Bitte ein Locked Photo auswählen.");
      }

      const body: Record<string, unknown> = {
        brandProfileId,
        contract_version: "adbot-creative-generation-v1",
        mode: genMode,
        provider_key: genConfig.providerKey,
        model_id: genModelId,
        prompt: genPrompt.trim() || undefined,
        reference_asset_ids: genStyleIds.slice(0, 4),
        locked_photo_asset_ids:
          genMode === "locked_photo" ? [genLockedAssetId] : [],
        output: { mime_type: "image/png", aspect_hint: "1:1" },
      };

      const response = await fetch(
        "/api/meta/automation/creative-assets/enqueue",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        jobId?: string;
        message?: string;
        error?: string;
      };
      if (!response.ok || !result.ok) {
        const code =
          typeof (result as { code?: unknown }).code === "string"
            ? (result as { code: string }).code
            : "";
        throw new Error(
          result.message ||
            result.error ||
            (code === "INSUFFICIENT_CREDITS"
              ? "Nicht genügend Credits für die KI-Grafik."
              : "Generierung konnte nicht gestartet werden."),
        );
      }
      const creditsReserved = (result as { creditsReserved?: unknown })
        .creditsReserved;
      setGenMessage(
        `Generierung gestartet${result.jobId ? ` (Job ${result.jobId.slice(0, 8)}…)` : ""}${
          typeof creditsReserved === "number"
            ? ` · ${creditsReserved} Credits reserviert`
            : ""
        }. Das Ergebnis erscheint in der Library, sobald der Worker fertig ist.`,
      );
      router.refresh();
    } catch (generateError) {
      setGenError(
        generateError instanceof Error
          ? generateError.message
          : "Generierung fehlgeschlagen.",
      );
    } finally {
      setGenPending(false);
    }
  }

  const busy = pending || Boolean(deletingId) || Boolean(actionId) || genPending;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-700">
            <Upload className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-extrabold tracking-tight">
              Creative hochladen
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              PNG/JPEG (256–4096px). Ein Bild: Adbot schneidet nur fehlende
              Meta-Formate zu (1:1, 4:5, 9:16). Fertige Formate kannst du im
              Creative-Dialog beim Launch einzeln hochladen. Brand-Profil ist
              optional — für Active Launch reicht die Zuordnung zum Launch.
            </p>
            {!metaConnected ? (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Bitte zuerst ein Meta-Werbekonto verbinden.
              </p>
            ) : (
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                {brandProfiles.length ? (
                  <label className="grid flex-1 gap-1 text-sm font-medium">
                    Brand-Profil (optional)
                    <select
                      className="h-10 rounded-lg border border-slate-200 px-3"
                      onChange={(event) => setBrandProfileId(event.target.value)}
                      value={brandProfileId}
                    >
                      <option value="">Ohne Profil speichern</option>
                      {brandProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.brandName}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ImagePlus className="size-4" />
                  )}
                  Datei wählen
                  <input
                    accept="image/png,image/jpeg"
                    className="hidden"
                    disabled={busy}
                    onChange={(event) => {
                      void onUpload(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                    type="file"
                  />
                </label>
              </div>
            )}
            {loadError ? (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
                {loadError}
              </p>
            ) : null}
            {error ? (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {error}
              </p>
            ) : null}
            {message ? (
              <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {message}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {metaConnected ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-slate-900 text-white">
              <Sparkles className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-extrabold tracking-tight">
                KI-Creative erzeugen
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Free: vollständiges KI-Bild. Locked Photo: KI-Hintergrund mit
                unverändert eingebettetem Foto. Optional Style-Referenzen aus
                markierten Beispielen (max. 4). Ergebnis erscheint nach dem
                Worker-Lauf in der Library.
              </p>

              {!genConfig?.configured ? (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  KI-Provider ist noch nicht konfiguriert. Sobald OpenRouter (oder
                  HTTP) live ist, kannst du hier generieren.
                </p>
              ) : !brandProfiles.length ? (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Aktives Brand-Profil im Control Center nötig.
                </p>
              ) : (
                <div className="mt-4 grid gap-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                        genMode === "free"
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                      disabled={busy}
                      onClick={() => setGenMode("free")}
                      type="button"
                    >
                      Free (KI-Bild)
                    </button>
                    <button
                      className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                        genMode === "locked_photo"
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                      disabled={busy}
                      onClick={() => setGenMode("locked_photo")}
                      type="button"
                    >
                      Locked Photo
                    </button>
                  </div>

                  <label className="grid gap-1 text-sm font-medium">
                    Brand-Profil
                    <select
                      className="h-10 rounded-lg border border-slate-200 px-3"
                      disabled={busy}
                      onChange={(event) => setBrandProfileId(event.target.value)}
                      value={brandProfileId}
                    >
                      {brandProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.brandName}
                        </option>
                      ))}
                    </select>
                  </label>

                  {genConfig.modelAllowlist.length > 1 ? (
                    <label className="grid gap-1 text-sm font-medium">
                      Modell
                      <select
                        className="h-10 rounded-lg border border-slate-200 px-3"
                        disabled={busy}
                        onChange={(event) => setGenModelId(event.target.value)}
                        value={genModelId}
                      >
                        {genConfig.modelAllowlist.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  {genMode === "locked_photo" ? (
                    <label className="grid gap-1 text-sm font-medium">
                      Locked Photo
                      <select
                        className="h-10 rounded-lg border border-slate-200 px-3"
                        disabled={busy}
                        onChange={(event) =>
                          setGenLockedAssetId(event.target.value)
                        }
                        value={genLockedAssetId}
                      >
                        <option value="">Bitte wählen…</option>
                        {lockedPhotoOptions.map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.originalFilename}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  {genMode === "locked_photo" &&
                  lockedPhotoOptions.length === 0 ? (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      Noch kein Locked Photo — markiere unten ein Upload mit dem
                      Schloss-Symbol.
                    </p>
                  ) : null}

                  {styleReferenceOptions.length > 0 ? (
                    <fieldset className="grid gap-2">
                      <legend className="text-sm font-medium">
                        Style-Referenzen (optional, max. 4)
                      </legend>
                      <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                        {styleReferenceOptions.map((asset) => {
                          const checked = genStyleIds.includes(asset.id);
                          const atLimit =
                            !checked && genStyleIds.length >= 4;
                          return (
                            <label
                              key={asset.id}
                              className="flex items-center gap-2 text-sm text-slate-700"
                            >
                              <input
                                checked={checked}
                                disabled={busy || atLimit}
                                onChange={() => {
                                  setGenStyleIds((previous) =>
                                    checked
                                      ? previous.filter((id) => id !== asset.id)
                                      : previous.length >= 4
                                        ? previous
                                        : [...previous, asset.id],
                                  );
                                }}
                                type="checkbox"
                              />
                              <span className="truncate">
                                {asset.originalFilename}
                                {asset.trainingStatus === "marked_good"
                                  ? " · gut"
                                  : ""}
                                {asset.trainingStatus === "performance_winner"
                                  ? " · winner"
                                  : ""}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Style-Referenzen: markiere Creatives mit dem Stern als
                      gutes Beispiel.
                    </p>
                  )}

                  <label className="grid gap-1 text-sm font-medium">
                    Prompt (optional)
                    <textarea
                      className="min-h-[88px] rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      disabled={busy}
                      maxLength={2000}
                      onChange={(event) => setGenPrompt(event.target.value)}
                      placeholder={
                        genMode === "locked_photo"
                          ? "z. B. weicher Studio-Hintergrund, Mitte freilassen"
                          : "z. B. Produktfoto, helles Tageslicht"
                      }
                      value={genPrompt}
                    />
                  </label>

                  <button
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    disabled={
                      busy ||
                      (genMode === "locked_photo" &&
                        lockedPhotoOptions.length === 0)
                    }
                    onClick={() => void onGenerate()}
                    type="button"
                  >
                    {genPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                    Generierung starten
                  </button>
                </div>
              )}

              {genError ? (
                <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {genError}
                </p>
              ) : null}
              {genMessage ? (
                <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  {genMessage}
                </p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-extrabold tracking-tight">Deine Creatives</h2>
        <p className="mt-1 text-sm text-slate-600">
          Stern = gutes Beispiel für späteres Lernen. Schloss = Locked Photo
          (unverändert einbetten).
        </p>
        {loadError ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
            {loadError}
          </p>
        ) : null}
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((asset) => {
            const formatLabel =
              asset.label?.trim() ||
              formatLabelForDimensions(asset.width, asset.height) ||
              "Eigenes Format";
            const sizeLabel =
              asset.width && asset.height
                ? `${asset.width}×${asset.height}`
                : "Größe unbekannt";
            const deleting = deletingId === asset.id;
            const acting = actionId === asset.id;
            const isLocked = asset.assetRole === "LOCKED_PHOTO";
            const isMarked = asset.trainingStatus === "marked_good";
            const canLock =
              asset.status === "READY" &&
              (asset.assetRole === "UPLOAD_EDITABLE" ||
                asset.assetRole === "LOCKED_PHOTO");

            return (
              <article
                key={asset.id}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white"
              >
                <div className="relative aspect-[4/5] bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    className="size-full object-cover"
                    loading="lazy"
                    src={`/api/media-library/preview?assetId=${asset.id}`}
                  />
                  <div className="absolute left-2 top-2 flex flex-wrap gap-1">
                    {isLocked ? (
                      <span className="rounded bg-slate-900/90 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                        Locked
                      </span>
                    ) : null}
                    {asset.assetRole === "GENERATED" ? (
                      <span className="rounded bg-blue-700/90 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                        KI
                      </span>
                    ) : null}
                    {isMarked ? (
                      <span className="rounded bg-amber-500/95 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                        Gut
                      </span>
                    ) : null}
                  </div>
                  <div className="absolute right-2 top-2 flex gap-1">
                    <button
                      aria-label={
                        isMarked
                          ? "Gute-Beispiel-Markierung entfernen"
                          : "Als gutes Beispiel markieren"
                      }
                      className="inline-flex size-9 items-center justify-center rounded-lg bg-white/95 text-amber-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-amber-50 disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void onToggleTraining(asset)}
                      type="button"
                    >
                      {acting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Star
                          className="size-4"
                          fill={isMarked ? "currentColor" : "none"}
                        />
                      )}
                    </button>
                    {canLock ? (
                      <button
                        aria-label={
                          isLocked
                            ? "Locked Photo aufheben"
                            : "Als Locked Photo markieren"
                        }
                        className="inline-flex size-9 items-center justify-center rounded-lg bg-white/95 text-slate-800 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50"
                        disabled={busy}
                        onClick={() => void onToggleLocked(asset)}
                        type="button"
                      >
                        {acting ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : isLocked ? (
                          <Lock className="size-4" />
                        ) : (
                          <Unlock className="size-4" />
                        )}
                      </button>
                    ) : null}
                    <button
                      aria-label="Creative löschen"
                      className="inline-flex size-9 items-center justify-center rounded-lg bg-white/95 text-rose-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-rose-50 disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void onDelete(asset.id)}
                      type="button"
                    >
                      {deleting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="space-y-1 p-3">
                  <p className="truncate text-sm font-extrabold text-slate-950">
                    {asset.originalFilename}
                  </p>
                  <p className="text-xs font-semibold text-blue-700">
                    {formatLabel}
                  </p>
                  <p className="text-xs text-slate-500">
                    {sizeLabel}
                    {asset.metaImageHashPresent ? " · Meta-Hash" : ""}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {new Date(asset.createdAt).toLocaleString("de-DE")}
                  </p>
                  {asset.status === "READY" ? (
                    <a
                      className="mt-2 inline-flex text-xs font-bold text-emerald-700 hover:underline"
                      href={`/dashboard?assetId=${asset.id}#traffic-launch`}
                    >
                      Für Traffic-Kampagne nutzen
                    </a>
                  ) : null}
                </div>
              </article>
            );
          })}
          {!assets.length && !loadError ? (
            <p className="text-sm text-slate-500 sm:col-span-2 lg:col-span-3">
              Noch keine Uploads.
            </p>
          ) : null}
          {!assets.length && loadError ? (
            <p className="text-sm font-semibold text-amber-900 sm:col-span-2 lg:col-span-3">
              Liste vorübergehend nicht verfügbar — Creatives sind weiterhin
              gespeichert.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
