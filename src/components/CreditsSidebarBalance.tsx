import { Coins } from "lucide-react";

export type CreditsSidebarBalanceProps = {
  /** null = noch kein Credit-Konto angelegt */
  balance: number | null;
  planName?: string | null;
  periodEnd?: string | null;
  /** Compact chip for the mobile header */
  compact?: boolean;
};

function formatCredits(value: number): string {
  return new Intl.NumberFormat("de-DE").format(value);
}

function formatPeriodEnd(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("de-DE", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Berlin",
  }).format(date);
}

/**
 * Customer-facing Adbot credit balance for the dashboard chrome.
 * No action keys, EUR conversion, or markup — only the usable balance.
 */
export function CreditsSidebarBalance({
  balance,
  planName = null,
  periodEnd = null,
  compact = false,
}: CreditsSidebarBalanceProps) {
  const low = balance !== null && balance < 50;
  const empty = balance === null;
  const label = empty
    ? "—"
    : formatCredits(balance);
  const periodLabel = formatPeriodEnd(periodEnd);

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold tabular-nums ${
          low
            ? "bg-amber-50 text-amber-800"
            : "bg-slate-100 text-slate-700"
        }`}
        title="Adbot-Credits"
      >
        <Coins className="size-3.5 shrink-0" aria-hidden />
        <span>
          {empty ? "Credits" : `${label} Credits`}
        </span>
      </span>
    );
  }

  return (
    <div
      className={`mb-2 rounded-xl px-3 py-2.5 ${
        low
          ? "bg-amber-50 text-amber-950"
          : "bg-slate-50 text-slate-900"
      }`}
      aria-label="Adbot-Credits"
    >
      <div className="flex items-center gap-2.5">
        <span
          className={`grid size-8 shrink-0 place-items-center rounded-lg ${
            low ? "bg-amber-100 text-amber-800" : "bg-white text-slate-700"
          }`}
        >
          <Coins className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
            Credits
          </p>
          <p className="truncate text-sm font-extrabold tabular-nums tracking-tight">
            {empty ? "Noch kein Guthaben" : label}
          </p>
        </div>
      </div>
      {!empty && (planName || periodLabel) ? (
        <p className="mt-1.5 truncate text-[11px] font-medium text-slate-500">
          {[planName, periodLabel ? `bis ${periodLabel}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
      {low && !empty ? (
        <p className="mt-1 text-[11px] font-semibold text-amber-800/90">
          Guthaben wird knapp
        </p>
      ) : null}
    </div>
  );
}
