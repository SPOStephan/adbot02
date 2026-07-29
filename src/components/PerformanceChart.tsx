type PerformancePoint = {
  date: string;
  spend: number;
};

type PerformanceChartProps = {
  currency: string;
  points: PerformancePoint[];
};

function formatShortDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function toPath(values: number[]) {
  if (values.length === 1) {
    return `M 0 ${100 - values[0]} L 100 ${100 - values[0]}`;
  }

  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 100 - value;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

export function PerformanceChart({ currency, points }: PerformanceChartProps) {
  if (!points.length) {
    return (
      <div className="mt-6 grid min-h-64 place-items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
        <div>
          <p className="font-bold text-slate-900">Noch keine Insights verfügbar</p>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
            Nach einem vollständigen read-only Kampagnenabruf erscheint hier der tägliche Ausgabenverlauf.
          </p>
        </div>
      </div>
    );
  }

  const maxSpend = Math.max(...points.map((point) => point.spend), 0);
  const normalized = points.map((point) =>
    maxSpend > 0 ? Math.max(4, (point.spend / maxSpend) * 88) : 4,
  );
  const linePath = toPath(normalized);
  const areaPath = `${linePath} L 100 100 L 0 100 Z`;
  const labelIndexes = Array.from(
    new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]),
  );

  return (
    <div className="mt-6">
      <div className="mb-4 flex items-center justify-between gap-3 text-xs text-slate-400">
        {labelIndexes.map((index) => (
          <span key={`${points[index].date}-${index}`}>
            {formatShortDate(points[index].date)}
          </span>
        ))}
      </div>
      <div className="relative h-64 overflow-hidden rounded-2xl bg-gradient-to-b from-blue-50/80 to-white p-4">
        <div className="pointer-events-none absolute inset-4 flex flex-col justify-between">
          {[0, 1, 2, 3].map((line) => (
            <span className="block border-t border-dashed border-slate-200" key={line} />
          ))}
        </div>
        <svg
          aria-label={`Tägliche Meta-Werbeausgaben. Höchster Tageswert ${formatMoney(maxSpend, currency)}.`}
          className="relative size-full overflow-visible"
          preserveAspectRatio="none"
          role="img"
          viewBox="0 0 100 100"
        >
          <defs>
            <linearGradient id="metaSpendArea" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#metaSpendArea)" />
          <path
            d={linePath}
            fill="none"
            stroke="#2563eb"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.4"
            vectorEffect="non-scaling-stroke"
          />
          {normalized.map((value, index) => (
            <circle
              cx={normalized.length === 1 ? 50 : (index / (normalized.length - 1)) * 100}
              cy={100 - value}
              fill="white"
              key={`${points[index].date}-${value}`}
              r="1.3"
              stroke="#2563eb"
              strokeWidth="0.8"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
