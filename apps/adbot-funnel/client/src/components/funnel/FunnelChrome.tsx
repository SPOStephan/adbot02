import type { CSSProperties, PropsWithChildren } from "react";
import type { FunnelBrand, FunnelConfig, FunnelSocialProof } from "@shared/funnel";
import { DEFAULT_PROGRESS } from "@shared/progressLayout";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { FunnelProgress } from "./FunnelProgress";
import { FormattedText } from "./FormattedText";

type FunnelChromeProps = PropsWithChildren<{
  brand: FunnelBrand;
  socialProof: FunnelSocialProof;
  privacyUrl: string;
  privacyLabel: string;
  imprintUrl: string;
  step: number;
  totalSteps: number;
  showProgress: boolean;
  fullBleed?: boolean;
  pages?: FunnelConfig["pages"];
  progress?: FunnelConfig["progress"];
  onBack?: () => void;
  onForward?: () => void;
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
  fullBleed = false,
  pages,
  progress,
  onBack,
  onForward,
  children,
}: FunnelChromeProps) {
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
    <div className={`funnel-canvas${fullBleed ? " funnel-canvas-benefits" : ""}`} lang="de" style={brandStyle}>
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

      {showProgress && pages ? (
        <FunnelProgress
          brand={brand}
          progress={progress ?? DEFAULT_PROGRESS}
          pages={pages}
          step={step}
          onBack={onBack}
          onForward={onForward}
        />
      ) : null}

      <main id="funnel-content" className="funnel-main">{children}</main>

      <footer className="funnel-footer">
        {socialProof.enabled && (
          <div className="funnel-proof">
            <span className="funnel-proof-icon"><ShieldCheck size={18} /></span>
            <span><FormattedText as="strong" value={socialProof.eyebrow} /><FormattedText value={socialProof.text} /></span>
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
