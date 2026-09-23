import type { FunnelBrand, StartPage } from "@shared/funnel";
import { contrastOnAccent, resolveStartLayout } from "@shared/startLayout";
import { ArrowRight, Check } from "lucide-react";
import { FunnelIcon } from "./FunnelIcon";

export function StartStep({
  page,
  brand,
  onContinue,
}: {
  page: StartPage;
  brand?: FunnelBrand;
  onContinue: () => void;
}) {
  if (resolveStartLayout(page) === "benefits") {
    return <BenefitsStartStep page={page} brand={brand} onContinue={onContinue} />;
  }

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

function BenefitsStartStep({
  page,
  brand,
  onContinue,
}: {
  page: StartPage;
  brand?: FunnelBrand;
  onContinue: () => void;
}) {
  const accent = brand?.accentColor ?? "#0165c3";
  const bandColor = brand?.accentColor ?? accent;
  const bandText = contrastOnAccent(bandColor);
  const bottomLabel = page.secondaryButtonLabel.trim() || page.buttonLabel;
  const backgroundUrl = page.heroBackgroundMobileUrl || page.heroBackgroundDesktopUrl;
  const opacity = Math.max(0, Math.min(100, page.heroBackgroundOpacity ?? 15)) / 100;

  return (
    <section className="funnel-start-benefits" aria-labelledby={`${page.id}-title`}>
      <div className={`funnel-start-benefits-hero${page.heroImageUrl ? " has-image" : ""}${backgroundUrl ? " has-background" : ""}`}>
        {backgroundUrl && (
          <div className="funnel-start-benefits-hero-bg" aria-hidden="true">
            <picture>
              {page.heroBackgroundDesktopUrl && <source media="(min-width: 640px)" srcSet={page.heroBackgroundDesktopUrl} />}
              <img src={backgroundUrl} alt="" style={{ opacity }} />
            </picture>
          </div>
        )}
        {page.heroImageUrl ? <img className="funnel-start-benefits-hero-photo" src={page.heroImageUrl} alt="" /> : <div className="funnel-start-benefits-hero-fallback" aria-hidden="true" />}
        <div className="funnel-start-benefits-hero-copy">
          {page.eyebrow && <p className="funnel-start-benefits-kicker">{page.eyebrow}</p>}
          <h1 id={`${page.id}-title`} tabIndex={-1}>{page.title}</h1>
          {page.description.trim() && <p className="funnel-start-benefits-lead">{page.description}</p>}
          <button className="funnel-primary-button funnel-start-benefits-button" type="button" onClick={onContinue}>
            {page.buttonLabel}
          </button>
          {page.trustNote && <p className="funnel-trust-note">{page.trustNote}</p>}
        </div>
      </div>

      {page.benefitsBandTitle.trim() && (
        <div className="funnel-start-benefits-band" style={{ background: bandColor, color: bandText }}>
          <h2>{page.benefitsBandTitle}</h2>
        </div>
      )}

      {page.benefits.length > 0 && (
        <div className="funnel-start-benefits-tiles-wrap">
          <ul className="funnel-start-benefits-tiles">
            {page.benefits.map(benefit => {
              const iconColor = benefit.color || accent;
              return (
                <li key={benefit.id}>
                  <span className="funnel-start-benefits-icon" style={{ color: iconColor }}>
                    <FunnelIcon name={benefit.icon} className="size-11" color={iconColor} />
                  </span>
                  <strong>{benefit.title}</strong>
                  {benefit.text.trim() && <p>{benefit.text}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="funnel-start-benefits-cta-wrap">
        <button className="funnel-primary-button funnel-start-benefits-button" type="button" onClick={onContinue}>
          {bottomLabel}
        </button>
      </div>
    </section>
  );
}
