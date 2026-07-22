const points = [18, 28, 24, 42, 38, 56, 52, 66, 61, 78, 72, 88];

function toPath(values: number[]) {
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 100 - value;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

export function PerformanceChart() {
  const linePath = toPath(points);
  const areaPath = `${linePath} L 100 100 L 0 100 Z`;

  return (
    <div className="mt-6">
      <div className="mb-4 flex items-center justify-between text-xs text-slate-400">
        <span>01. Juli</span>
        <span>07. Juli</span>
        <span>14. Juli</span>
        <span>21. Juli</span>
      </div>
      <div className="relative h-64 overflow-hidden rounded-2xl bg-gradient-to-b from-blue-50/80 to-white p-4">
        <div className="pointer-events-none absolute inset-4 flex flex-col justify-between">
          {[0, 1, 2, 3].map((line) => (
            <span className="block border-t border-dashed border-slate-200" key={line} />
          ))}
        </div>
        <svg
          aria-label="Demoverlauf der generierten Leads"
          className="relative size-full overflow-visible"
          preserveAspectRatio="none"
          role="img"
          viewBox="0 0 100 100"
        >
          <defs>
            <linearGradient id="leadArea" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#leadArea)" />
          <path
            d={linePath}
            fill="none"
            stroke="#2563eb"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.4"
            vectorEffect="non-scaling-stroke"
          />
          {points.map((value, index) => (
            <circle
              cx={(index / (points.length - 1)) * 100}
              cy={100 - value}
              fill="white"
              key={`${index}-${value}`}
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
