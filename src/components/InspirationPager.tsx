"use client";

type InspirationPagerProps = {
  page: number;
  pageCount: number;
  total: number;
  disabled?: boolean;
  onPage: (page: number) => void;
  noun?: string;
};

export function InspirationPager({
  page,
  pageCount,
  total,
  disabled = false,
  onPage,
  noun = "Beispiele",
}: InspirationPagerProps) {
  if (total < 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-sm font-semibold text-slate-600">
        {total} {noun} · Seite {page} von {pageCount}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-extrabold text-slate-800 hover:bg-slate-50 disabled:opacity-40"
          disabled={disabled || page <= 1}
          onClick={() => onPage(1)}
          type="button"
        >
          Anfang
        </button>
        <button
          className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-extrabold text-slate-800 hover:bg-slate-50 disabled:opacity-40"
          disabled={disabled || page <= 1}
          onClick={() => onPage(page - 1)}
          type="button"
        >
          Zurück
        </button>
        <button
          className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-extrabold text-slate-800 hover:bg-slate-50 disabled:opacity-40"
          disabled={disabled || page >= pageCount}
          onClick={() => onPage(page + 1)}
          type="button"
        >
          Weiter
        </button>
        <button
          className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-extrabold text-slate-800 hover:bg-slate-50 disabled:opacity-40"
          disabled={disabled || page >= pageCount}
          onClick={() => onPage(pageCount)}
          type="button"
        >
          Ende
        </button>
      </div>
    </div>
  );
}
