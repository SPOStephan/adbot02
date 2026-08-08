import type { CSSProperties, PropsWithChildren } from "react";
import type { FunnelBrand, FunnelSocialProof } from "@shared/funnel";
import { LockKeyhole, ShieldCheck } from "lucide-react";

type FunnelChromeProps = PropsWithChildren<{
  brand: FunnelBrand;
  socialProof: FunnelSocialProof;
  privacyUrl: string;
  privacyLabel: string;
  imprintUrl: string;
  step: number;
  totalSteps: number;
  showProgress: boolean;
}>;

export function FunnelChrome({
  brand,
  socialProof,
  privacyUrl,
  privacyLabel,
  imprintUrl,
  step,
  totalSteps,
  showProgress,
  children,
}: FunnelChromeProps) {
  const progress = totalSteps <= 1 ? 100 : Math.round((step / (totalSteps - 1)) * 100);
  const brandStyle = {
    backgroundColor: brand.backgroundColor,
    color: brand.textColor,
    "--funnel-accent": brand.accentColor,
    "--funnel-bg": brand.backgroundColor,
    "--funnel-surface": brand.surfaceColor,
    "--funnel-ink": brand.textColor,
    "--funnel-muted": `color-mix(in srgb, ${brand.textColor} 68%, transparent)`,
    "--funnel-choice-bg": brand.choiceBackgroundColor,
    "--funnel-choice-text": brand.choiceTextColor,
    "--funnel-choice-selected-bg": brand.choiceSelectedBackgroundColor,
    "--funnel-choice-selected-text": brand.choiceSelectedTextColor,
    "--funnel-choice-selected-border": brand.choiceSelectedBorderColor,
  } as CSSProperties;
  return (
    <div className="funnel-canvas" style={brandStyle}>
      <a className="funnel-skip-link" href="#funnel-content">Zum Hauptinhalt springen</a>
      <header className="funnel-header" aria-label="Funnel-Kopfbereich">
        <div className="funnel-logo-wrap">
          {brand.logoUrl ? (
            <img className="funnel-logo" src={brand.logoUrl} alt={brand.logoAlt} />
          ) : (
            <div className="funnel-wordmark" aria-label={brand.logoAlt}>
              <span className="funnel-wordmark-mark">ME</span>
              <span>Dein Unternehmen</span>
            </div>
          )}
        </div>
        <div className="funnel-security"><LockKeyhole size={14} /> SSL-verschlüsselt</div>
      </header>

      {showProgress && (
        <div className="funnel-progress" role="progressbar" aria-label="Bewerbungsfortschritt" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <div className="funnel-progress-meta">
            <span>Schritt {Math.min(step + 1, totalSteps)} von {totalSteps}</span>
            <span>{progress}%</span>
          </div>
          <div className="funnel-progress-track" aria-hidden="true"><div className="funnel-progress-value" style={{ width: `${progress}%` }} /></div>
        </div>
      )}

      <main id="funnel-content" className="funnel-main">{children}</main>

      <footer className="funnel-footer">
        {socialProof.enabled && (
          <div className="funnel-proof">
            <span className="funnel-proof-icon"><ShieldCheck size={18} /></span>
            <span><strong>{socialProof.eyebrow}</strong>{socialProof.text}</span>
          </div>
        )}
        <nav className="funnel-legal-links" aria-label="Rechtliche Hinweise">
          <a href={privacyUrl} target="_blank" rel="noreferrer">{privacyLabel}</a>
          <a href={imprintUrl}>Impressum</a>
        </nav>
      </footer>
    </div>
  );
}
