type DashboardPageHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
};

export function DashboardPageHeader({
  eyebrow,
  title,
  description,
}: DashboardPageHeaderProps) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
        {eyebrow}
      </p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-2xl text-slate-500">{description}</p>
    </div>
  );
}

/** Lightweight body placeholder while route data streams in. */
export function DashboardContentSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="mt-8 space-y-4">
      <div className="h-28 animate-pulse rounded-2xl bg-slate-200/70" />
      <div className="h-48 animate-pulse rounded-2xl bg-slate-200/60" />
      <div className="h-36 animate-pulse rounded-2xl bg-slate-200/50" />
    </div>
  );
}
