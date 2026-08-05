"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export type InstagramConfirmCandidate = {
  id: string;
  username: string | null;
  name: string;
  pageId: string;
  pageName: string;
};

type InstagramAssetConfirmProps = {
  candidates: InstagramConfirmCandidate[];
};

export function InstagramAssetConfirm({
  candidates,
}: InstagramAssetConfirmProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!candidates.length) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
        <p className="font-bold">Instagram-Bestätigung erforderlich</p>
        <p className="mt-2">
          Meta hat keine Instagram-Ziel-IDs geliefert, und über deine verbundenen
          Facebook-Seiten ist derzeit kein lesbares Instagram-Profil erreichbar.
          Bitte im Meta-Dialog Instagram ausdrücklich wählen und erneut verbinden.
        </p>
      </div>
    );
  }

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!selected.length) {
      setError("Bitte mindestens das Instagram-Konto ankreuzen, das du im Meta-Dialog gewählt hast.");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/connectors/meta/instagram-confirm", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ selectedIds: selected }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };

        if (!response.ok || !payload.ok) {
          setError(
            payload.error === "invalid_selection"
              ? "Die Auswahl enthält Profile, die Meta gerade nicht freigibt."
              : "Die Bestätigung konnte nicht gespeichert werden. Bitte erneut versuchen.",
          );
          return;
        }

        router.refresh();
      } catch {
        setError("Die Bestätigung konnte nicht gespeichert werden. Bitte erneut versuchen.");
      }
    });
  }

  return (
    <form
      className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm leading-6 text-blue-950"
      onSubmit={handleSubmit}
    >
      <p className="font-bold">Instagram ausdrücklich bestätigen</p>
      <p className="mt-2">
        Meta hat keine Instagram-Ziel-IDs geliefert. Damit kein Fantasiewert wie
        eine reine Seitenverknüpfung gespeichert wird: Bitte markiere nur die
        Konten, die du im Meta-Dialog wirklich gewählt hast.
      </p>
      <ul className="mt-4 space-y-3">
        {candidates.map((candidate) => {
          const label = candidate.username
            ? `@${candidate.username}`
            : candidate.name;
          const checked = selected.includes(candidate.id);

          return (
            <li key={candidate.id}>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-white/80 px-4 py-3 ring-1 ring-blue-100">
                <input
                  checked={checked}
                  className="mt-1 size-4"
                  disabled={pending}
                  onChange={() => toggle(candidate.id)}
                  type="checkbox"
                />
                <span>
                  <span className="block font-bold">{label}</span>
                  <span className="mt-1 block text-xs text-blue-800/80">
                    verknüpft mit Facebook-Seite „{candidate.pageName}“
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p className="mt-3 text-sm font-semibold text-red-700">{error}</p>
      ) : null}
      <button
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Speichern…" : "Auswahl speichern"}
      </button>
    </form>
  );
}
