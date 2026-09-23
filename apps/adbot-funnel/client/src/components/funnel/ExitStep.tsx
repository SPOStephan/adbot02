import { ArrowRight } from "lucide-react";
import type { FunnelGate } from "@shared/funnel";
import { fillGateText } from "@shared/funnelGate";

export function ExitStep({
  gate,
  mode,
  targetTitle,
  continueLabel,
  onContinue,
}: {
  gate: FunnelGate;
  mode: "exit" | "handoff";
  targetTitle?: string;
  continueLabel: string;
  onContinue?: () => void;
}) {
  const title = mode === "handoff" ? gate.handoffTitle : gate.exitTitle;
  const text = fillGateText(mode === "handoff" ? gate.handoffText : gate.exitText, { targetTitle });
  return (
    <section className="funnel-step funnel-exit-step" aria-labelledby="funnel-exit-title">
      <p className="funnel-eyebrow">{mode === "handoff" ? "Hinweis" : "Rückmeldung"}</p>
      <h1 id="funnel-exit-title" tabIndex={-1}>{title}</h1>
      <p className="funnel-description">{text}</p>
      {mode === "handoff" && onContinue ? (
        <div className="funnel-step-actions">
          <button className="funnel-primary-button" type="button" onClick={onContinue}>
            {continueLabel}<ArrowRight size={18} />
          </button>
        </div>
      ) : null}
    </section>
  );
}
