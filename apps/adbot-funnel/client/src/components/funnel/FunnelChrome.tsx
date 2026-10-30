import { useLayoutEffect, useRef, useState, type CSSProperties, type PropsWithChildren } from "react";
import type { FunnelBrand, FunnelConfig, FunnelSocialProof } from "@shared/funnel";
import { DEFAULT_PROGRESS } from "@shared/progressLayout";
import { resolveButtonColors } from "@shared/startLayout";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { FunnelProgress } from "./FunnelProgress";
import { FormattedText } from "./FormattedText";

type FunnelChromeProps = PropsWithChildren<{
  brand: FunnelBrand;
  socialProof: FunnelSocialProof;
  privacyUrl: string;
  privacyLabel: string;
  privacyExternal?: boolean;
  imprintUrl: string;
  imprintExternal?: boolean;
  step: number;
  totalSteps: number;
  showProgress: boolean;
  fullBleed?: boolean;
  /** Optional fill for logo + progress on the benefits start page. */
  topBackground?: string;
  /** Optional CSS gradient spanning logo, progress and the start hero as one surface. */
  topGradient?: string;
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
  privacyExternal = false,
  imprintUrl,
  imprintExternal = false,
  step,
  totalSteps,
  showProgress,
  fullBleed = false,
  topBackground,
  topGradient,
  pages,
  progress,
  onBack,
  onForward,
  children,
}: FunnelChromeProps) {
  const button = resolveButtonColors(brand);
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
    "--funnel-button": button.background,
    "--funnel-button-text": button.text,
    ...(button.hover ? { "--funnel-button-hover": button.hover } : {}),
  } as CSSProperties;
  const canvasRef = useRef<HTMLDivElement>(null);
  const gradientHeight = useHeroFillHeight(canvasRef, fullBleed ? topGradient : undefined);
  const top = (
    <>
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
    </>
  );
  return (
    <div ref={canvasRef} className={`funnel-canvas${fullBleed ? " funnel-canvas-benefits" : ""}${fullBleed && (topBackground || topGradient) ? " has-hero-color" : ""}`} lang="de" style={brandStyle}>
      <a className="funnel-skip-link" href="#funnel-content">Zum Hauptinhalt springen</a>
      {fullBleed && topGradient && gradientHeight > 0 ? (
        <div className="funnel-top-gradient" aria-hidden="true" style={{ background: topGradient, height: gradientHeight }} />
      ) : null}
      {fullBleed ? (
        <div className="funnel-start-top" style={topBackground ? { background: topBackground } : undefined}>
          {top}
        </div>
      ) : top}

      <main id="funnel-content" className="funnel-main">{children}</main>

      <footer className="funnel-footer">
        {socialProof.enabled && (
          <div className="funnel-proof">
            <span className="funnel-proof-icon"><ShieldCheck size={18} /></span>
            <span><FormattedText as="strong" value={socialProof.eyebrow} /><FormattedText value={socialProof.text} /></span>
          </div>
        )}
        <nav className="funnel-legal-links" aria-label="Rechtliche Hinweise">
          <a href={privacyUrl} {...(privacyExternal ? { target: "_blank", rel: "noreferrer" } : {})}>{privacyLabel}</a>
          <a href={imprintUrl} {...(imprintExternal ? { target: "_blank", rel: "noreferrer" } : {})}>Impressum</a>
        </nav>
      </footer>
    </div>
  );
}

/** Height from the canvas top to the bottom of the start hero, so one gradient covers both. */
function useHeroFillHeight(canvasRef: { current: HTMLDivElement | null }, gradient: string | undefined) {
  const enabled = Boolean(gradient);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!enabled || !canvas) return;
    const measure = () => {
      const hero = canvas.querySelector<HTMLElement>(".funnel-start-benefits-hero");
      if (!hero) return setHeight(0);
      // offsetTop ignores CSS transforms, so the scaled editor preview measures correctly.
      let top = 0;
      for (let node: HTMLElement | null = hero; node && node !== canvas; node = node.offsetParent as HTMLElement | null) top += node.offsetTop;
      setHeight(top + hero.offsetHeight);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    const hero = canvas.querySelector(".funnel-start-benefits-hero");
    if (hero) observer.observe(hero);
    return () => observer.disconnect();
  }, [canvasRef, enabled, gradient]);
  return enabled ? height : 0;
}
