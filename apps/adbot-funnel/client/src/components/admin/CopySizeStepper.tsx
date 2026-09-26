import { ChevronDown, ChevronUp } from "lucide-react";
import { clampCopySizeStep, copySizeLabel, MAX_COPY_SIZE_STEP, MIN_COPY_SIZE_STEP } from "@shared/copySize";
import { Button } from "@/components/ui/button";

export function CopySizeStepper({
  value,
  onChange,
  areaLabel,
}: {
  value?: number;
  onChange: (step: number) => void;
  areaLabel: string;
}) {
  const step = clampCopySizeStep(value);
  return (
    <div
      className="inline-flex items-center rounded-md border bg-white px-0.5"
      title="Schriftgröße dieses Bereichs. Standard ist die bisherige Größe."
    >
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label={`${areaLabel} kleiner`}
        title="Kleiner"
        disabled={step <= MIN_COPY_SIZE_STEP}
        onClick={() => onChange(clampCopySizeStep(step - 1))}
      >
        <ChevronDown className="size-3.5" />
      </Button>
      <span className="min-w-[4.25rem] text-center text-[11px] font-semibold tabular-nums" aria-live="polite">
        {copySizeLabel(step)}
      </span>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label={`${areaLabel} größer`}
        title="Größer"
        disabled={step >= MAX_COPY_SIZE_STEP}
        onClick={() => onChange(clampCopySizeStep(step + 1))}
      >
        <ChevronUp className="size-3.5" />
      </Button>
    </div>
  );
}
