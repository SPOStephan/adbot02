import type { CSSProperties } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import type { FunnelBrand, FunnelPage, FunnelProgress as FunnelProgressConfig } from "@shared/funnel";
import {
  progressPercent,
  resolveProgressColors,
  resolveProgressLayout,
  resolveProgressSteps,
  type ResolvedProgressColors,
  type ResolvedProgressStep,
} from "@shared/progressLayout";
import { FunnelIcon } from "./FunnelIcon";

export function FunnelProgress({
  brand,
  progress,
  pages,
  step,
  onBack,
  onForward,
}: {
  brand: FunnelBrand;
  progress: FunnelProgressConfig;
  pages: FunnelPage[];
  step: number;
  onBack?: () => void;
  onForward?: () => void;
}) {
  const layout = resolveProgressLayout(progress.layout);
  const colors = resolveProgressColors(brand, progress.colors);
  const steps = resolveProgressSteps(pages, step);
  const total = Math.max(steps.length, 1);
  const currentIndex = Math.min(Math.max(step, 0), total - 1);
  const percent = progressPercent(currentIndex, total);
  const current = steps[currentIndex];

  return (
    <div
      className={`funnel-progress funnel-progress-${layout}`}
      role="progressbar"
      aria-label="Bewerbungsfortschritt"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      style={{
        "--fp-active": colors.active,
        "--fp-completed": colors.completed,
        "--fp-upcoming": colors.upcoming,
        "--fp-text": colors.text,
        "--fp-muted": colors.muted,
        "--fp-track": colors.track,
      } as CSSProperties}
    >
      {layout === "percent" ? (
        <PercentProgress percent={percent} currentIndex={currentIndex} total={total} />
      ) : layout === "bar" ? (
        <BarProgress steps={steps} percent={percent} />
      ) : layout === "reduced" ? (
        <ReducedProgress
          current={current}
          currentIndex={currentIndex}
          total={total}
          percent={percent}
          onBack={onBack}
          onForward={onForward}
        />
      ) : layout === "chevrons" ? (
        <ChevronProgress steps={steps} />
      ) : layout === "bold" ? (
        <BoldProgress steps={steps} />
      ) : layout === "checks" ? (
        <CheckProgress steps={steps} />
      ) : layout === "chips" ? (
        <ChipProgress steps={steps} />
      ) : layout === "brand" ? (
        <BrandProgress steps={steps} colors={colors} />
      ) : layout === "illustrated" ? (
        <IllustratedProgress steps={steps} colors={colors} />
      ) : layout === "icons" ? (
        <IconProgress steps={steps} colors={colors} />
      ) : (
        <MinimalProgress steps={steps} />
      )}
    </div>
  );
}

function PercentProgress({ percent, currentIndex, total }: { percent: number; currentIndex: number; total: number }) {
  return (
    <>
      <div className="funnel-progress-meta">
        <span>Schritt {currentIndex + 1} von {total}</span>
        <span>{percent}%</span>
      </div>
      <ProgressTrack percent={percent} />
    </>
  );
}

function BarProgress({ steps, percent }: { steps: ResolvedProgressStep[]; percent: number }) {
  return (
    <>
      <ProgressTrack percent={percent} />
      <ol className="funnel-progress-list">
        {steps.map((item, index) => (
          <li key={item.id} data-state={item.state}>
            <strong>{index + 1}. {item.title}</strong>
            {item.hint ? <span>{item.hint}</span> : null}
          </li>
        ))}
      </ol>
    </>
  );
}

function ReducedProgress({
  current,
  currentIndex,
  total,
  percent,
  onBack,
  onForward,
}: {
  current?: ResolvedProgressStep;
  currentIndex: number;
  total: number;
  percent: number;
  onBack?: () => void;
  onForward?: () => void;
}) {
  return (
    <>
      <div className="funnel-progress-reduced-head">
        <p className="funnel-progress-kicker">Schritt {currentIndex + 1} von {total}</p>
        <div className="funnel-progress-reduced-nav">
          <button type="button" aria-label="Vorheriger Schritt" disabled={!onBack || currentIndex <= 0} onClick={onBack}>
            <ChevronLeft size={18} />
          </button>
          <button type="button" aria-label="Nächster Schritt" disabled={!onForward || currentIndex >= total - 1} onClick={onForward}>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      {current ? (
        <div className="funnel-progress-reduced-copy">
          <strong>{current.title}</strong>
          {current.hint ? <span>{current.hint}</span> : null}
        </div>
      ) : null}
      <ProgressTrack percent={percent} />
    </>
  );
}

function MinimalProgress({ steps }: { steps: ResolvedProgressStep[] }) {
  return (
    <ol className="funnel-progress-stepper">
      {steps.map((item, index) => (
        <li key={item.id} data-state={item.state}>
          <span className="funnel-progress-dot" aria-hidden="true">{index + 1}</span>
          <strong>{item.title}</strong>
          {item.hint ? <span>{item.hint}</span> : null}
        </li>
      ))}
    </ol>
  );
}

function IconProgress({ steps, colors }: { steps: ResolvedProgressStep[]; colors: ResolvedProgressColors }) {
  return (
    <ol className="funnel-progress-stepper funnel-progress-stepper-icons">
      {steps.map(item => (
        <li key={item.id} data-state={item.state}>
          <span className="funnel-progress-dot" aria-hidden="true">
            <FunnelIcon name={item.icon} className="size-4" color={item.state === "upcoming" ? colors.muted : "#ffffff"} />
          </span>
          <strong>{item.title}</strong>
          {item.hint ? <span>{item.hint}</span> : null}
        </li>
      ))}
    </ol>
  );
}

function IllustratedProgress({ steps, colors }: { steps: ResolvedProgressStep[]; colors: ResolvedProgressColors }) {
  return (
    <ol className="funnel-progress-stepper funnel-progress-stepper-illustrated">
      {steps.map(item => (
        <li key={item.id} data-state={item.state}>
          <span className="funnel-progress-dot" aria-hidden="true">
            <FunnelIcon name={item.icon} className="size-4" color={item.state === "upcoming" ? colors.muted : colors.active} />
          </span>
          <strong>{item.title}</strong>
          {item.hint ? <span>{item.hint}</span> : null}
        </li>
      ))}
    </ol>
  );
}

function BoldProgress({ steps }: { steps: ResolvedProgressStep[] }) {
  return (
    <ol className="funnel-progress-stepper funnel-progress-stepper-bold">
      {steps.map((item, index) => (
        <li key={item.id} data-state={item.state}>
          <span className="funnel-progress-dot" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <strong>{item.title}</strong>
          {item.hint ? <span>{item.hint}</span> : null}
        </li>
      ))}
    </ol>
  );
}

function CheckProgress({ steps }: { steps: ResolvedProgressStep[] }) {
  return (
    <ol className="funnel-progress-stepper funnel-progress-stepper-checks">
      {steps.map((item, index) => (
        <li key={item.id} data-state={item.state}>
          <span className="funnel-progress-dot" aria-hidden="true">
            {item.state === "completed" ? <Check size={14} strokeWidth={2.4} /> : index + 1}
          </span>
          <strong>{item.title}</strong>
          {item.hint ? <span>{item.hint}</span> : null}
        </li>
      ))}
    </ol>
  );
}

function ChipProgress({ steps }: { steps: ResolvedProgressStep[] }) {
  return (
    <ol className="funnel-progress-chips">
      {steps.map((item, index) => (
        <li key={item.id} data-state={item.state}>
          <em>{index + 1}</em>
          <strong>{item.title}</strong>
          {item.hint ? <span>{item.hint}</span> : null}
        </li>
      ))}
    </ol>
  );
}

function ChevronProgress({ steps }: { steps: ResolvedProgressStep[] }) {
  return (
    <ol className="funnel-progress-chevrons">
      {steps.map((item, index) => (
        <li key={item.id} data-state={item.state}>
          <span className="funnel-progress-dot" aria-hidden="true">
            <FunnelIcon name={item.icon} className="size-4" />
          </span>
          <div>
            <em>{index + 1}. {item.title}</em>
            {item.hint ? <span>{item.hint}</span> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function BrandProgress({ steps, colors }: { steps: ResolvedProgressStep[]; colors: ResolvedProgressColors }) {
  return (
    <ol className="funnel-progress-stepper funnel-progress-stepper-brand">
      {steps.map(item => (
        <li key={item.id} data-state={item.state}>
          <span className="funnel-progress-dot" aria-hidden="true">
            <FunnelIcon
              name={item.icon}
              className="size-4"
              color={item.state === "upcoming" ? colors.muted : item.state === "current" ? colors.active : colors.completed}
            />
          </span>
          <strong>{item.title}</strong>
          {item.hint ? <span>{item.hint}</span> : null}
        </li>
      ))}
    </ol>
  );
}

function ProgressTrack({ percent }: { percent: number }) {
  return (
    <div className="funnel-progress-track" aria-hidden="true">
      <div className="funnel-progress-value" style={{ width: `${percent}%` }} />
    </div>
  );
}
