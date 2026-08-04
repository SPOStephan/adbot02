"use client";

import { FormEvent, useState, useTransition } from "react";
import { Camera, Check, Save } from "lucide-react";
import { useRouter } from "next/navigation";

export type InstagramProfileOption = {
  metaAssetId: string;
  name: string;
  username: string | null;
  selected: boolean;
};

type ApiResponse = {
  ok?: boolean;
  message?: string;
};

export function InstagramProfileSelector({
  profiles,
}: {
  profiles: InstagramProfileOption[];
}) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [selectedIds, setSelectedIds] = useState(
    () => new Set(profiles.filter((profile) => profile.selected).map((profile) => profile.metaAssetId)),
  );
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  function toggleProfile(metaAssetId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(metaAssetId)) {
        next.delete(metaAssetId);
      } else {
        next.add(metaAssetId);
      }
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedIds.size < 1) {
      setNotice({
        tone: "error",
        message: "Bitte wähle mindestens ein Instagram-Profil aus.",
      });
      return;
    }

    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/meta/automation/instagram-selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instagramAccountIds: [...selectedIds] }),
      });
      const result = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || !result.ok) {
        throw new Error(result.message ?? "Die Instagram-Auswahl konnte nicht gespeichert werden.");
      }

      setNotice({
        tone: "success",
        message: "Instagram-Auswahl gespeichert. Adbot verwendet nur diese Profile.",
      });
      startRefresh(() => router.refresh());
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Die Instagram-Auswahl konnte nicht gespeichert werden.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="scroll-mt-24 border-b border-slate-200 bg-white px-5 py-6 sm:px-7"
      id="instagram-onboarding"
      onSubmit={submit}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-pink-600">
            <Camera className="size-4" />
            Instagram-Onboarding
          </div>
          <h3 className="mt-2 text-lg font-extrabold text-slate-950">
            Instagram-Profile für Adbot auswählen
          </h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            Nur ausgewählte Profile werden synchronisiert und als Instagram-Identität für deine Ads verwendet.
          </p>
        </div>
        <button
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-pink-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending || isRefreshing || selectedIds.size < 1}
          type="submit"
        >
          <Save className="size-4" />
          {pending ? "Wird gespeichert …" : "Auswahl speichern"}
        </button>
      </div>

      {profiles.length > 0 ? (
        <fieldset className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <legend className="sr-only">Verfügbare Instagram-Profile</legend>
          {profiles.map((profile) => {
            const selected = selectedIds.has(profile.metaAssetId);
            return (
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition ${
                  selected
                    ? "border-pink-300 bg-pink-50 text-pink-950"
                    : "border-slate-200 bg-white text-slate-900 hover:border-slate-300"
                }`}
                key={profile.metaAssetId}
              >
                <input
                  checked={selected}
                  className="sr-only"
                  onChange={() => toggleProfile(profile.metaAssetId)}
                  type="checkbox"
                />
                <span
                  className={`grid size-9 shrink-0 place-items-center rounded-full ${
                    selected ? "bg-pink-600 text-white" : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {selected ? <Check className="size-4" /> : <Camera className="size-4" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-extrabold">{profile.name}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {profile.username ? `@${profile.username}` : `ID ${profile.metaAssetId}`}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
      ) : (
        <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          Meta hat noch kein Instagram-Profil geliefert. Bitte Meta erneut verbinden und das Instagram-Konto im Dialog freigeben.
        </p>
      )}

      {notice ? (
        <p
          className={`mt-4 rounded-xl px-4 py-3 text-sm font-semibold ${
            notice.tone === "success"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-red-50 text-red-800"
          }`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      ) : null}
    </form>
  );
}
