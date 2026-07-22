import { ArrowUpRight, CircleDot, type LucideIcon } from "lucide-react";

export type PlatformStatusCardProps = {
  name: string;
  description: string;
  status: string;
  accentClass: string;
  icon: LucideIcon;
  connected?: boolean;
};

export function PlatformStatusCard({
  name,
  description,
  status,
  accentClass,
  icon: Icon,
  connected = false,
}: PlatformStatusCardProps) {
  return (
    <article className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <span className={`grid size-11 place-items-center rounded-xl ${accentClass}`}>
          <Icon className="size-5" />
        </span>
        <ArrowUpRight className="size-5 text-slate-300 transition group-hover:text-slate-600" />
      </div>
      <h3 className="mt-5 font-bold text-slate-950">{name}</h3>
      <p className="mt-1 min-h-10 text-sm leading-5 text-slate-500">{description}</p>
      <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-slate-600">
        <CircleDot className={`size-3.5 ${connected ? "text-emerald-500" : "text-blue-500"}`} />
        {status}
      </p>
    </article>
  );
}
