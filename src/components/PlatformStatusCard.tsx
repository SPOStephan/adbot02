import Link from "next/link";
import {
  ArrowUpRight,
  CheckCircle2,
  CircleDot,
  LockKeyhole,
  type LucideIcon,
} from "lucide-react";

export type PlatformStatusCardProps = {
  name: string;
  description: string;
  status: string;
  accentClass: string;
  icon: LucideIcon;
  connected?: boolean;
  badge?: string;
  helperText?: string;
  actionHref?: string;
  actionLabel?: string;
};

export function PlatformStatusCard({
  name,
  description,
  status,
  accentClass,
  icon: Icon,
  connected = false,
  badge,
  helperText,
  actionHref,
  actionLabel,
}: PlatformStatusCardProps) {
  const canConnect = Boolean(actionHref && actionLabel && !connected);

  return (
    <article className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <span className={`grid size-11 place-items-center rounded-xl ${accentClass}`}>
          <Icon className="size-5" />
        </span>
        {badge ? (
          <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-blue-700">
            {badge}
          </span>
        ) : (
          <ArrowUpRight className="size-5 text-slate-300 transition group-hover:text-slate-600" />
        )}
      </div>

      <h3 className="mt-5 font-bold text-slate-950">{name}</h3>
      <p className="mt-1 min-h-10 text-sm leading-5 text-slate-500">{description}</p>
      <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-slate-600">
        {connected ? (
          <CheckCircle2 className="size-3.5 text-emerald-500" />
        ) : (
          <CircleDot className="size-3.5 text-blue-500" />
        )}
        {status}
      </p>

      {helperText ? (
        <div className="mt-4 flex gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
          <LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-blue-600" />
          <p>{helperText}</p>
        </div>
      ) : null}

      <div className="mt-auto pt-5">
        {connected ? (
          <div className="flex items-center justify-center gap-2 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700">
            <CheckCircle2 className="size-4" />
            Aktiv verbunden
          </div>
        ) : canConnect ? (
          <Link
            className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            href={actionHref!}
            prefetch={false}
          >
            {actionLabel}
            <ArrowUpRight className="size-4" />
          </Link>
        ) : (
          <div className="rounded-xl bg-slate-100 px-4 py-2.5 text-center text-sm font-bold text-slate-400">
            In Vorbereitung
          </div>
        )}
      </div>
    </article>
  );
}
