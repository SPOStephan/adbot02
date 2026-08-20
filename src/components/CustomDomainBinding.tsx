"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe2, LoaderCircle, Trash2 } from "lucide-react";

import type { CustomerCustomDomainView } from "@/lib/custom-domains/types";
import {
  bindingLabelText,
  DEFAULT_CUSTOM_DOMAIN_DNS_TARGET,
  originLabel,
} from "@/lib/custom-domains/types";

type Notice = { tone: "success" | "error"; message: string } | null;

type Props = {
  domains: CustomerCustomDomainView[];
};

async function apiJson(
  body: Record<string, unknown>,
): Promise<Record<string, unknown> & { ok?: boolean; message?: string }> {
  const response = await fetch("/api/custom-domains", {
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
        : "Die Domain-Aktion konnte nicht abgeschlossen werden.",
    );
  }
  return result;
}

export function CustomDomainBinding({ domains }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [hostname, setHostname] = useState("");
  const [label, setLabel] = useState("");

  async function registerDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice(null);
    try {
      const result = await apiJson({
        action: "register",
        hostname: hostname.trim(),
        label: label.trim(),
      });
      setHostname("");
      setLabel("");
      setNotice({
        tone: "success",
        message:
          typeof result.message === "string"
            ? result.message
            : "Domain hinterlegt.",
      });
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Domain konnte nicht hinterlegt werden.",
      });
    } finally {
      setPending(false);
    }
  }

  async function verifyDomain(domainId: string) {
    setPending(true);
    setNotice(null);
    try {
      const result = await apiJson({
        action: "verify",
        domainId,
        activate: true,
      });
      setNotice({
        tone: "success",
        message:
          typeof result.message === "string"
            ? result.message
            : "DNS geprüft.",
      });
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "DNS-Prüfung fehlgeschlagen.",
      });
    } finally {
      setPending(false);
    }
  }

  async function revokeDomain(domainId: string) {
    setPending(true);
    setNotice(null);
    try {
      await apiJson({ action: "revoke", domainId });
      setNotice({ tone: "success", message: "Domain zurückgezogen." });
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Domain konnte nicht zurückgezogen werden.",
      });
    } finally {
      setPending(false);
    }
  }

  const inputClass =
    "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100";

  return (
    <section
      className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white px-5 py-7 shadow-sm sm:px-7"
      id="custom-domains"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700">
          <Globe2 className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-blue-700">
            Custom Domains
          </p>
          <h2 className="mt-1 text-xl font-extrabold tracking-tight text-slate-950">
            Domains global verbinden
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Optional hier einmal hinterlegen — oder direkt im Funnel- bzw.
            Freebie-Admin anlegen. Alles erscheint in dieser Liste. Verbundene
            Domains sind beim Anlegen von Kampagnen wählbar. Hosting/Routing
            bleibt im jeweiligen Tool (eigene Subdomain + eigene Datenbank).
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

      <form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={registerDomain}>
        <label className="text-sm font-bold text-slate-800 sm:col-span-2">
          Hostname
          <input
            className={inputClass}
            disabled={pending}
            onChange={(event) => setHostname(event.target.value)}
            placeholder="leads.meine-marke.de"
            required
            value={hostname}
          />
        </label>
        <label className="text-sm font-bold text-slate-800 sm:col-span-2">
          Bezeichnung (optional)
          <input
            className={inputClass}
            disabled={pending}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Haupt-Domain"
            value={label}
          />
        </label>
        <div className="sm:col-span-2">
          <p className="text-xs leading-5 text-slate-500">
            DNS: CNAME auf{" "}
            <span className="font-semibold text-slate-700">
              {DEFAULT_CUSTOM_DOMAIN_DNS_TARGET}
            </span>
            . Domain zusätzlich im Vercel-Projekt freigeben (SSL). Danach „DNS
            prüfen & aktivieren“.
          </p>
          <button
            className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={pending || !hostname.trim()}
            type="submit"
          >
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Domain hinzufügen
          </button>
        </div>
      </form>

      <div className="mt-8 space-y-3">
        <h3 className="text-sm font-extrabold text-slate-900">
          Hinterlegte Domains
        </h3>
        {domains.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">
            Noch keine Domain. Optional hier hinzufügen — oder im Funnel-/Freebie-Admin
            anlegen; sie erscheint dann hier.
          </p>
        ) : (
          <ul className="space-y-3">
            {domains.map((domain) => (
              <li
                className="flex flex-col gap-3 rounded-xl border border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                key={domain.id}
              >
                <div className="min-w-0">
                  <p className="truncate font-bold text-slate-950">
                    {domain.hostname}
                    {domain.label ? (
                      <span className="ml-2 text-sm font-medium text-slate-500">
                        ({domain.label})
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {domain.status === "READY" ? "Verbunden" : "DNS ausstehend"}
                    {" · "}
                    Angelegt in {originLabel(domain.origin)}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {bindingLabelText(domain.bindingKind, domain.bindingLabel)}
                  </p>
                  {domain.lastDnsMessage ? (
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {domain.lastDnsMessage}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {domain.status !== "READY" ? (
                    <button
                      className="inline-flex items-center rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800 transition hover:bg-blue-100 disabled:opacity-50"
                      disabled={pending}
                      onClick={() => void verifyDomain(domain.id)}
                      type="button"
                    >
                      DNS prüfen & aktivieren
                    </button>
                  ) : (
                    <button
                      className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                      disabled={pending}
                      onClick={() => void verifyDomain(domain.id)}
                      type="button"
                    >
                      DNS erneut prüfen
                    </button>
                  )}
                  <button
                    aria-label={`${domain.hostname} zurückziehen`}
                    className="inline-flex items-center gap-1 rounded-xl border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                    disabled={pending}
                    onClick={() => void revokeDomain(domain.id)}
                    type="button"
                  >
                    <Trash2 className="size-3.5" />
                    Entfernen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
