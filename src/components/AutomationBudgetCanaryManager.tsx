"use client";

import {
  AlertTriangle,
  ArrowRight,
  BadgeEuro,
  CheckCircle2,
  Fingerprint,
  LoaderCircle,
  ShieldAlert,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export type BudgetCanaryPlanView = {
  planId: string;
  campaignName: string;
  budgetOwnerLabel: string;
  targetType: "CAMPAIGN" | "AD_SET";
  currentBudgetMinor: string;
  intendedBudgetMinor: string;
  direction: "INCREASE" | "DECREASE" | "UNCHANGED";
  changeBps: number;
  payloadHash: string;
  reason: string | null;
  createdAt: string;
  expiresAt: string | null;
  expired: boolean;
  freshSync: boolean;
  approvedAt: string | null;
  status: string;
};

type AutomationBudgetCanaryManagerProps = {
  plans: BudgetCanaryPlanView[];
  currency: string;
  canPrepare: boolean;
  canConfirm: boolean;
};

type CanaryResponse = {
  ok?: boolean;
  message?: string;
  outcome?: "CREATED" | "EXISTING";
  approvalId?: string;
  planId?: string;
  status?: string;
  executableAt?: string;
};

type Notice = {
  tone: "success" | "error";
  message: string;
};

async function postCanaryPreparation(body: {
  reason: string;
  confirmation: string;
}): Promise<CanaryResponse> {
  const response = await fetch("/api/meta/automation/budget-canary/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as CanaryResponse | null;
  if (!response.ok) {
    throw new Error(result?.message ?? "Der Budget-Canary konnte nicht vorbereitet werden.");
  }
  return result ?? {};
}

async function postCanaryApproval(body: {
  planId: string;
  payloadHash: string;
  currentBudgetMinor: string;
  intendedBudgetMinor: string;
  reason: string;
  confirmation: string;
}): Promise<CanaryResponse> {
  const response = await fetch("/api/meta/automation/budget-canary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as CanaryResponse | null;
  if (!response.ok) {
    throw new Error(result?.message ?? "Der Budget-Canary konnte nicht bestätigt werden.");
  }
  return result ?? {};
}

function formatMinor(value: string, currency: string): string {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return `${value} Minor Units`;
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
  }).format(parsed / 100);
}

function formatChange(changeBps: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(changeBps / 10_000);
}

function formatDate(value: string | null): string {
  if (!value) return "ohne Ablaufdatum";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "unbekannt";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

export function AutomationBudgetCanaryManager({
  plans,
  currency,
  canPrepare,
  canConfirm,
}: AutomationBudgetCanaryManagerProps) {
  const router = useRouter();
  const [preparePending, setPreparePending] = useState(false);
  const [prepareReason, setPrepareReason] = useState("");
  const [prepareConfirmation, setPrepareConfirmation] = useState("");
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);

  async function prepareCanary(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canPrepare || plans.length > 0) return;

    const confirmed = window.confirm(
      "Einen gehaltenen Einmal-Canary vorbereiten? Adbot berechnet exakt 10 % weniger Tagesbudget. Dieser Schritt sendet noch nichts an Meta.",
    );
    if (!confirmed) return;

    setPreparePending(true);
    setNotice(null);
    try {
      await postCanaryPreparation({
        reason: prepareReason,
        confirmation: prepareConfirmation,
      });
      setNotice({
        tone: "success",
        message:
          "Der 10-%-Canary wurde ausschließlich als eingefrorener Plan vorbereitet. Prüfe Betrag und Fingerprint; erst eine separate Freigabe darf ihn ausführbar machen.",
      });
      setPrepareReason("");
      setPrepareConfirmation("");
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Der Budget-Canary konnte nicht vorbereitet werden.",
      });
    } finally {
      setPreparePending(false);
    }
  }

  async function approvePlan(
    event: FormEvent<HTMLFormElement>,
    plan: BudgetCanaryPlanView,
  ) {
    event.preventDefault();
    if (!canConfirm || plan.approvedAt) return;

    const confirmed = window.confirm(
      `Diesen realen Meta-Budget-Canary freigeben? ${formatMinor(
        plan.currentBudgetMinor,
        currency,
      )} werden zu ${formatMinor(plan.intendedBudgetMinor, currency)}. ` +
        "Nach der Freigabe darf der nächste Executor-Lauf die Änderung an Meta senden.",
    );
    if (!confirmed) return;

    setActivePlanId(plan.planId);
    setNotice(null);
    try {
      await postCanaryApproval({
        planId: plan.planId,
        payloadHash: plan.payloadHash,
        currentBudgetMinor: plan.currentBudgetMinor,
        intendedBudgetMinor: plan.intendedBudgetMinor,
        reason,
        confirmation,
      });
      setNotice({
        tone: "success",
        message:
          "Der exakt angezeigte Budgetplan ist freigegeben. Der nächste Executor-Lauf darf ausschließlich diesen Plan an Meta senden.",
      });
      setReason("");
      setConfirmation("");
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Der Budget-Canary konnte nicht bestätigt werden.",
      });
    } finally {
      setActivePlanId(null);
    }
  }

  return (
    <div className="border-b border-slate-200 bg-amber-50/40 px-5 py-6 sm:px-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800">
            <BadgeEuro className="size-5" />
          </span>
          <div>
            <h3 className="font-extrabold">Budget-Canary</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              Budgetpläne bleiben standardmäßig planbezogen eingefroren. Eine
              Bestätigung gibt genau einen unveränderten Plan für den nächsten
              Executor-Lauf frei.
            </p>
          </div>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-900">
          {plans.length} prüfbare Pläne
        </span>
      </div>

      <div className="mt-5 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-100/70 p-4 text-amber-950">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <p className="text-xs leading-5">
          <strong>Reale Meta-Änderung:</strong> Nach der Bestätigung kann der
          Executor das angezeigte Tagesbudget tatsächlich ändern. Andere
          Kampagnen, Statusänderungen und neue Launches bleiben gesperrt.
        </p>
      </div>

      {!canConfirm && plans.length > 0 ? (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-slate-300 bg-white p-4 text-slate-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" />
          <p className="text-xs leading-5">
            Bestätigungen sind gesperrt, bis genau ein Budgetowner verwaltet
            wird, ein aktueller Meta-Abruf vorliegt, das Konto explizit auf
            <strong> ALLOW</strong> steht und die aktive Policy ausschließlich
            Budgetänderungen erlaubt.
          </p>
        </div>
      ) : null}

      {notice ? (
        <p
          className={`mt-4 rounded-xl px-4 py-3 text-sm font-semibold ${
            notice.tone === "success"
              ? "bg-emerald-100 text-emerald-900"
              : "bg-red-100 text-red-900"
          }`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      ) : null}

      <div className="mt-5 grid gap-4">
        {plans.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5">
            <div className="text-center">
              <p className="font-extrabold text-slate-900">
                Noch kein bestätigungsfähiger Budgetplan vorhanden
              </p>
              <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Für den ersten Live-Nachweis kann Adbot einmalig einen
                deterministischen Plan mit exakt <strong>10 % weniger</strong>
                Tagesbudget erzeugen. Der Plan bleibt eingefroren und kann Meta
                erst nach einer zweiten, fingerprintgebundenen Freigabe erreichen.
              </p>
            </div>

            {!canPrepare ? (
              <div className="mt-5 flex items-start gap-3 rounded-xl border border-slate-300 bg-slate-50 p-4 text-slate-700">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" />
                <p className="text-xs leading-5">
                  Die Vorbereitung ist gesperrt. Erforderlich sind genau ein
                  verwalteter Budgetowner, ein erfolgreicher aktueller Meta-Abruf,
                  EUR, <strong>FREEZE_WRITES</strong> und eine aktive Budget-only-Policy.
                </p>
              </div>
            ) : null}

            <form className="mx-auto mt-5 grid max-w-2xl gap-4" onSubmit={prepareCanary}>
              <label className="grid gap-2 text-left text-sm font-bold text-slate-800">
                Begründung der Vorbereitung
                <textarea
                  className="min-h-24 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none transition focus:border-amber-600 focus:ring-4 focus:ring-amber-100"
                  disabled={!canPrepare || preparePending}
                  maxLength={500}
                  minLength={12}
                  onChange={(event) => setPrepareReason(event.target.value)}
                  placeholder="Warum wird jetzt genau dieser einzelne, gehaltene 10-%-Canary vorbereitet?"
                  required
                  value={prepareReason}
                />
              </label>
              <label className="grid gap-2 text-left text-sm font-bold text-slate-800">
                Zur Vorbereitung exakt „CANARY VORBEREITEN“ eingeben
                <input
                  autoComplete="off"
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none transition focus:border-amber-600 focus:ring-4 focus:ring-amber-100"
                  disabled={!canPrepare || preparePending}
                  onChange={(event) => setPrepareConfirmation(event.target.value)}
                  required
                  value={prepareConfirmation}
                />
              </label>
              <button
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-extrabold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 sm:justify-self-center"
                disabled={
                  !canPrepare ||
                  preparePending ||
                  prepareConfirmation !== "CANARY VORBEREITEN" ||
                  prepareReason.trim().length < 12
                }
                type="submit"
              >
                {preparePending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <BadgeEuro className="size-4" />
                )}
                Gehaltenen 10-%-Plan vorbereiten
              </button>
            </form>
          </div>
        ) : (
          plans.map((plan) => {
            const approved = Boolean(plan.approvedAt);
            const pending = activePlanId === plan.planId;
            const ready = canConfirm && !approved && !plan.expired && plan.freshSync;

            return (
              <article
                className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm"
                key={plan.planId}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-amber-800">
                      {plan.targetType === "CAMPAIGN"
                        ? "Kampagnenbudget"
                        : "Anzeigengruppenbudget"}
                    </p>
                    <h4 className="mt-1 text-lg font-extrabold text-slate-950">
                      {plan.campaignName}
                    </h4>
                    <p className="mt-1 text-sm font-semibold text-slate-500">
                      {plan.budgetOwnerLabel}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                      approved
                        ? "bg-emerald-100 text-emerald-800"
                        : plan.expired
                          ? "bg-slate-200 text-slate-700"
                          : "bg-amber-100 text-amber-900"
                    }`}
                  >
                    {approved
                      ? "Freigegeben"
                      : plan.expired
                        ? "Abgelaufen"
                        : "Wartet auf Bestätigung"}
                  </span>
                </div>

                <div className="mt-5 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      Aktuell
                    </p>
                    <p className="mt-1 text-lg font-extrabold text-slate-950">
                      {formatMinor(plan.currentBudgetMinor, currency)}
                    </p>
                  </div>
                  <ArrowRight className="size-5 shrink-0 text-amber-700" />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      Vorgeschlagen
                    </p>
                    <p className="mt-1 text-lg font-extrabold text-slate-950">
                      {formatMinor(plan.intendedBudgetMinor, currency)}
                    </p>
                  </div>
                  <span className="sm:ml-auto rounded-full bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 shadow-sm">
                    {plan.direction === "INCREASE" ? "+" : plan.direction === "DECREASE" ? "−" : ""}
                    {formatChange(plan.changeBps)}
                  </span>
                </div>

                <div className="mt-4 grid gap-2 text-xs leading-5 text-slate-600 sm:grid-cols-2">
                  <p>
                    <strong>Planner-Grund:</strong> {plan.reason ?? "Regelbasierter Budgetvorschlag"}
                  </p>
                  <p>
                    <strong>Gültig bis:</strong> {formatDate(plan.expiresAt)}
                  </p>
                  <p className="inline-flex items-center gap-2 sm:col-span-2">
                    <Fingerprint className="size-4 shrink-0" />
                    <span className="font-mono">{plan.payloadHash.slice(0, 12)}…{plan.payloadHash.slice(-12)}</span>
                  </p>
                </div>

                {approved ? (
                  <div className="mt-5 flex items-start gap-3 rounded-xl bg-emerald-50 p-4 text-emerald-900">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                    <p className="text-xs leading-5">
                      Exakt dieser Fingerprint wurde am {formatDate(plan.approvedAt)}
                      freigegeben. Änderungen am Plan würden eine neue
                      Bestätigung erfordern.
                    </p>
                  </div>
                ) : (
                  <form className="mt-5 grid gap-4" onSubmit={(event) => approvePlan(event, plan)}>
                    <label className="grid gap-2 text-sm font-bold text-slate-800">
                      Begründung der Freigabe
                      <textarea
                        className="min-h-24 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none transition focus:border-amber-600 focus:ring-4 focus:ring-amber-100"
                        disabled={!ready || pending}
                        maxLength={500}
                        minLength={12}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder="Warum wird genau dieser einzelne Canary jetzt freigegeben?"
                        required
                        value={reason}
                      />
                    </label>
                    <label className="grid gap-2 text-sm font-bold text-slate-800">
                      Zur Bestätigung exakt „BUDGET ÄNDERN“ eingeben
                      <input
                        autoComplete="off"
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none transition focus:border-amber-600 focus:ring-4 focus:ring-amber-100"
                        disabled={!ready || pending}
                        onChange={(event) => setConfirmation(event.target.value)}
                        required
                        value={confirmation}
                      />
                    </label>
                    <button
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-700 px-4 py-3 text-sm font-extrabold text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50 sm:justify-self-start"
                      disabled={
                        !ready ||
                        pending ||
                        confirmation !== "BUDGET ÄNDERN" ||
                        reason.trim().length < 12
                      }
                      type="submit"
                    >
                      {pending ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <ShieldAlert className="size-4" />
                      )}
                      Exakt diesen Budgetplan freigeben
                    </button>
                  </form>
                )}
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
