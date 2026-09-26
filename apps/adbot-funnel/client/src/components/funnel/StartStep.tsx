import type { CSSProperties } from "react";
import { isPageDescriptionShown, isPageEyebrowShown, isPageTitleShown, type FunnelBrand, type StartPage } from "@shared/funnel";
import { clampHeroBackgroundFocusX, contrastOnAccent, resolveBadgeColors, resolveBenefitsCardBackground, resolveBenefitsSectionBackground, resolveBenefitsTileGap, resolveBenefitsTileLayout, resolveStartLayout } from "@shared/startLayout";
import { ArrowRight, Check } from "lucide-react";
import { FunnelIcon } from "./FunnelIcon";
import { FormattedText } from "./FormattedText";
import { stripFormattedText } from "@shared/formattedText";

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
        {isPageEyebrowShown(page) && <FormattedText as="p" className="funnel-eyebrow" value={page.eyebrow} />}
        <FormattedText as="h1" id={`${page.id}-title`} className={isPageTitleShown(page) ? undefined : "funnel-sr-only"} tabIndex={-1} value={page.title} />
        {isPageDescriptionShown(page) && <FormattedText as="p" className="funnel-description" value={page.description} />}
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
  const focusX = clampHeroBackgroundFocusX(page.heroBackgroundFocusX);
  const tileLayout = resolveBenefitsTileLayout(page.benefitsTileLayout);
  const tileGap = resolveBenefitsTileGap(page.benefitsTileGap);
  const ink = brand?.textColor ?? "#10253f";
  const cards = tileLayout === "cards";
  const sectionBackground = cards ? resolveBenefitsSectionBackground(page.benefitsSectionBackground) : undefined;
  const cardBackground = cards ? resolveBenefitsCardBackground(page.benefitsCardBackground) : undefined;

  return (
    <section className="funnel-start-benefits" aria-labelledby={`${page.id}-title`}>
      <div className={`funnel-start-benefits-hero${page.heroImageUrl.trim() ? " has-portrait" : ""}${backgroundUrl ? " has-background" : ""}`}>
        {backgroundUrl && (
          <div className="funnel-start-benefits-hero-bg" aria-hidden="true" style={{ "--hero-bg-focus-x": `${focusX}%` } as CSSProperties}>
            <picture>
              {page.heroBackgroundDesktopUrl && <source media="(min-width: 640px)" srcSet={page.heroBackgroundDesktopUrl} />}
              <img src={backgroundUrl} alt="" style={{ opacity }} />
            </picture>
          </div>
        )}
        <div className="funnel-start-benefits-hero-copy">
          {page.heroImageUrl.trim() ? <img className="funnel-start-benefits-portrait" src={page.heroImageUrl} alt="" /> : null}
          {isPageEyebrowShown(page) && <FormattedText as="p" className="funnel-start-benefits-kicker" value={page.eyebrow} />}
          <FormattedText as="h1" id={`${page.id}-title`} className={isPageTitleShown(page) ? undefined : "funnel-sr-only"} tabIndex={-1} value={page.title} />
          {(page.badges ?? []).length > 0 && (
            <ul className="funnel-start-benefits-badges">
              {(page.badges ?? []).map(badge => {
                const colors = resolveBadgeColors(badge, ink);
                return (
                  <li
                    key={badge.id}
                    className="funnel-start-benefits-badge"
                    style={{ background: colors.background, color: colors.text, borderColor: badge.backgroundColor || "color-mix(in srgb, var(--funnel-ink) 14%, transparent)" }}
                  >
                    {badge.label}
                  </li>
                );
              })}
            </ul>
          )}
          {isPageDescriptionShown(page) && <FormattedText as="p" className="funnel-start-benefits-lead" value={page.description} />}
          <button className="funnel-primary-button funnel-start-benefits-button" type="button" onClick={onContinue}>
            {page.buttonLabel}
          </button>
          {page.trustNote && <p className="funnel-trust-note">{page.trustNote}</p>}
        </div>
      </div>

      {stripFormattedText(page.benefitsBandTitle) && (
        <div className="funnel-start-benefits-band" style={{ background: bandColor, color: bandText }}>
          <FormattedText as="h2" value={page.benefitsBandTitle} />
        </div>
      )}

      {page.benefits.length > 0 && (
        <div
          className={`funnel-start-benefits-tiles-wrap${cards ? " is-cards" : ""}`}
          style={cards ? {
            background: sectionBackground,
            "--benefits-card-bg": cardBackground,
          } as CSSProperties : undefined}
        >
          <ul className={`funnel-start-benefits-tiles is-${tileLayout} is-gap-${tileGap}`}>
            {page.benefits.map(benefit => {
              const iconColor = benefit.color || accent;
              return (
                <li key={benefit.id}>
                  <span className="funnel-start-benefits-icon" style={{ color: iconColor }}>
                    <FunnelIcon name={benefit.icon} className="size-11" color={iconColor} />
                  </span>
                  <span className="funnel-start-benefits-copy">
                    <FormattedText as="strong" value={benefit.title} />
                    {stripFormattedText(benefit.text) ? <FormattedText as="p" value={benefit.text} /> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="funnel-start-benefits-cta-wrap" style={cards ? { background: sectionBackground } : undefined}>
        <button className="funnel-primary-button funnel-start-benefits-button" type="button" onClick={onContinue}>
          {bottomLabel}
        </button>
      </div>
    </section>
  );
}
