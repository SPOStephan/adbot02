import type { StartPage } from "@shared/funnel";
import { ArrowRight, Check } from "lucide-react";

export function StartStep({ page, onContinue }: { page: StartPage; onContinue: () => void }) {
  return (
    <section className="funnel-step funnel-start-step" aria-labelledby={`${page.id}-title`}>
      <div className="funnel-copy">
        {page.eyebrow && <p className="funnel-eyebrow">{page.eyebrow}</p>}
        <h1 id={`${page.id}-title`} tabIndex={-1}>{page.title}</h1>
        <p className="funnel-description">{page.description}</p>
        <ul className="funnel-benefits">
          {page.bullets.map(bullet => <li key={bullet}><Check size={17} />{bullet}</li>)}
        </ul>
        <button className="funnel-primary-button" type="button" onClick={onContinue}>
          {page.buttonLabel}<ArrowRight size={19} />
        </button>
        {page.trustNote && <p className="funnel-trust-note">{page.trustNote}</p>}
      </div>
      <div className="funnel-hero-art" aria-hidden="true">
        {page.heroImageUrl ? (
          <img src={page.heroImageUrl} alt="" />
        ) : (
          <div className="funnel-art-card">
            <span className="funnel-art-dot funnel-art-dot-one" />
            <span className="funnel-art-dot funnel-art-dot-two" />
            <div className="funnel-art-person"><span /><span /><span /></div>
            <div className="funnel-art-badge"><Check size={18} /><span>In 2 Minuten<br /><strong>beworben</strong></span></div>
          </div>
        )}
      </div>
    </section>
  );
}
