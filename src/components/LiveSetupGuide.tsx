import Link from "next/link";
import { ArrowRight, CircleCheck } from "lucide-react";

import {
  LIVE_SETUP_GUIDE,
  LIVE_SETUP_STEPS,
  type LiveSetupStep,
} from "@/lib/help/lead-funnel-setup";

function StepLink({ step, compact = false }: { step: LiveSetupStep; compact?: boolean }) {
  const className = compact
    ? "inline-flex items-center gap-1 text-sm font-semibold text-blue-700 underline-offset-2 hover:underline"
    : "inline-flex items-center gap-2 rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-extrabold text-white transition hover:bg-blue-800";

  if (step.external) {
    return (
      <a className={className} href={step.href} rel="noopener noreferrer" target="_blank">
        {step.actionLabel}
        <ArrowRight className="size-4" />
      </a>
    );
  }

  return (
    <Link className={className} href={step.href}>
      {step.actionLabel}
      <ArrowRight className="size-4" />
    </Link>
  );
}

export function LiveSetupChecklist({
  currentId,
}: {
  currentId?: LiveSetupStep["id"];
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-blue-700">
            Anleitung
          </p>
          <h2 className="mt-1 text-lg font-extrabold tracking-tight text-slate-950">
            Nächste Schritte für den Live-Test
          </h2>
        </div>
        <Link
          className="text-sm font-semibold text-blue-700 underline-offset-2 hover:underline"
          href="/dashboard/hilfe"
        >
          Alle Schritte öffnen
        </Link>
      </div>
      <ol className="mt-4 space-y-3">
        {LIVE_SETUP_STEPS.map((step, index) => {
          const active = step.id === currentId;
          return (
            <li
              className={`rounded-xl border px-4 py-3 ${
                active
                  ? "border-blue-200 bg-blue-50"
                  : "border-slate-200 bg-slate-50/60"
              }`}
              key={step.id}
            >
              <p className="text-sm font-bold text-slate-950">
                {index + 1}. {step.title}
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-600">{step.summary}</p>
              {active ? (
                <p className="mt-2 text-xs font-semibold text-blue-800">
                  Du bist bei diesem Schritt.
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function LiveSetupGuide() {
  return (
    <div className="mt-8 space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-blue-700">
          Kundenhilfe
        </p>
        <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">
          {LIVE_SETUP_GUIDE.title}
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          {LIVE_SETUP_GUIDE.intro}
        </p>
      </section>

      <ol className="space-y-5">
        {LIVE_SETUP_STEPS.map((step, index) => (
          <li
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
            key={step.id}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.18em] text-blue-700">
                  <CircleCheck className="size-4" />
                  Schritt {index + 1}
                </p>
                <h3 className="mt-2 text-xl font-extrabold tracking-tight text-slate-950">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{step.summary}</p>
                <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">
                  {step.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              </div>
              <div className="shrink-0">
                <StepLink step={step} />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
