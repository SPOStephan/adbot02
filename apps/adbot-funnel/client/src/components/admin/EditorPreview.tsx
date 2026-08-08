import { useState } from "react";
import type { ContactPage, FunnelConfig, FunnelPage } from "@shared/funnel";
import { FunnelChrome } from "@/components/funnel/FunnelChrome";
import { StartStep } from "@/components/funnel/StartStep";
import { ChoiceStep } from "@/components/funnel/ChoiceStep";
import { ContactStep } from "@/components/funnel/ContactStep";

export function EditorPreview({ config, page }: { config: FunnelConfig; page: FunnelPage }) {
  const step = Math.max(0, config.pages.findIndex(item => item.id === page.id));
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const choose = (key: string, value: string, multiple: boolean) => setAnswers(current => {
    const selected = current[key] ?? [];
    return { ...current, [key]: multiple ? (selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]) : [value] };
  });
  return (
    <div className="admin-live-preview">
      <FunnelChrome brand={config.brand} socialProof={config.socialProof} privacyUrl={config.privacyUrl} privacyLabel={config.privacyLabel} imprintUrl={`/f/${config.slug}/impressum`} step={step} totalSteps={config.pages.length} showProgress>
        {page.type === "start" ? (
          <StartStep page={page} onContinue={() => undefined} />
        ) : page.type === "choice-grid" || page.type === "choice-list" ? (
          <ChoiceStep page={page} selected={answers[page.questionKey] ?? []} onSelect={value => choose(page.questionKey, value, page.allowMultiple)} onBack={() => undefined} onContinue={() => undefined} />
        ) : (
          <ContactStep page={page as ContactPage} contact={{}} consent={false} pending={false} onContactChange={() => undefined} onConsentChange={() => undefined} onResumeChange={() => undefined} onFileError={() => undefined} onBack={() => undefined} onSubmit={() => undefined} />
        )}
      </FunnelChrome>
    </div>
  );
}
