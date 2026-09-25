import { useState } from "react";
import { isFunnelPageHidden, visibleFunnelPages, type ContactPage, type FunnelConfig, type FunnelPage } from "@shared/funnel";
import { resolveStartLayout } from "@shared/startLayout";
import { FunnelChrome } from "@/components/funnel/FunnelChrome";
import { StartStep } from "@/components/funnel/StartStep";
import { ChoiceStep } from "@/components/funnel/ChoiceStep";
import { ContactStep } from "@/components/funnel/ContactStep";

export function EditorPreview({ config, page }: { config: FunnelConfig; page: FunnelPage }) {
  const visible = visibleFunnelPages(config.pages);
  const step = Math.max(0, visible.findIndex(item => item.id === page.id));
  const hidden = isFunnelPageHidden(page);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const choose = (key: string, value: string, multiple: boolean) => setAnswers(current => {
    const selected = current[key] ?? [];
    return { ...current, [key]: multiple ? (selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]) : [value] };
  });
  return (
    <div className={`admin-live-preview ${hidden ? "opacity-60 grayscale" : ""}`}>
      {hidden ? (
        <p className="mb-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
          Vorschau einer ausgeblendeten Seite – Bewerber sehen sie nicht.
        </p>
      ) : null}
      <FunnelChrome brand={config.brand} socialProof={config.socialProof} privacyUrl={config.privacyUrl} privacyLabel={config.privacyLabel} imprintUrl={`/f/${config.slug}/impressum`} step={step} totalSteps={visible.length} showProgress={!hidden} pages={visible} progress={config.progress} fullBleed={page.type === "start" && resolveStartLayout(page) === "benefits"}>
        {page.type === "start" ? (
          <StartStep page={page} brand={config.brand} onContinue={() => undefined} />
        ) : page.type === "choice-grid" || page.type === "choice-list" ? (
          <ChoiceStep page={page} selected={answers[page.questionKey] ?? []} onSelect={value => choose(page.questionKey, value, page.allowMultiple)} onBack={() => undefined} onContinue={() => undefined} />
        ) : (
          <ContactStep page={page as ContactPage} contact={{}} consent={false} pending={false} onContactChange={() => undefined} onConsentChange={() => undefined} onResumeChange={() => undefined} onFileError={() => undefined} onBack={() => undefined} onSubmit={() => undefined} />
        )}
      </FunnelChrome>
    </div>
  );
}
