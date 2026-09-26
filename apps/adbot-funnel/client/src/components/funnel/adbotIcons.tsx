import type { ReactElement, ReactNode } from "react";
import type { AdbotFunnelIcon } from "@shared/funnel";

/** Extra viewBox padding so Adbot glyphs match Lucide’s optical size in the blue tile. */
export const ADBOT_ICON_VIEWBOX = "-2.5 -2.5 29 29";
export const ADBOT_ICON_STROKE = 1.55;

function StrokeIcon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg className={className} viewBox={ADBOT_ICON_VIEWBOX} fill="none" stroke="currentColor" strokeWidth={ADBOT_ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const adbotIconMap: Record<AdbotFunnelIcon, (props: { className?: string }) => ReactElement> = {
  "adbot-vacation-days": ({ className }) => (
    <StrokeIcon className={className}>
      <rect x="3.5" y="4.5" width="17" height="16" rx="2.2" />
      <path d="M8 3.5v3M16 3.5v3M3.5 9.2h17" />
      <path d="m8.6 15.1 2.1 2.1 4.8-5" />
    </StrokeIcon>
  ),
  "adbot-profit-share": ({ className }) => (
    <StrokeIcon className={className}>
      <path d="M8.2 13.2c0-1.7 1.8-3 4.3-3s4.3 1.3 4.3 3-1.8 3-4.3 3-4.3-1.3-4.3-3Z" />
      <path d="M12.5 7.4v2.2M12.5 16.4v2.2" />
      <path d="M4.2 11.2c.4-3.6 3.4-6.4 8.3-6.4 4.9 0 7.9 2.8 8.3 6.4" />
      <path d="M4.2 16.4h3.4M16.4 16.4h3.4" />
    </StrokeIcon>
  ),
  "adbot-training-path": ({ className }) => (
    <StrokeIcon className={className}>
      <path d="M4 10.2 12 6l8 4.2-8 4.2L4 10.2Z" />
      <path d="M7.2 12.1v4.2c0 .8 2.1 2.1 4.8 2.1s4.8-1.3 4.8-2.1v-4.2" />
      <path d="M20 10.4v5.3" />
    </StrokeIcon>
  ),
  "adbot-mobile-work": ({ className }) => (
    <StrokeIcon className={className}>
      <rect x="3.5" y="5.2" width="12.4" height="9.2" rx="1.4" />
      <path d="M3.5 12.2h12.4M7.8 16.8h8.6a2 2 0 0 0 2-2V8.4" />
      <path d="M8.4 16.8h3.4" />
    </StrokeIcon>
  ),
  "adbot-flex-hours": ({ className }) => (
    <StrokeIcon className={className}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.4v5l3.2 1.8" />
      <path d="M4.4 7.2 3 5.8M19.6 7.2 21 5.8" />
    </StrokeIcon>
  ),
  "adbot-company-car": ({ className }) => (
    <StrokeIcon className={className}>
      <path d="M4 14.4h16l-1.2-4.2a2.4 2.4 0 0 0-2.3-1.7H8.2a2.4 2.4 0 0 0-2.4 1.7L4 14.4Z" />
      <path d="M6.2 8.5 8 5.8h8l1.8 2.7" />
      <circle cx="7.4" cy="16.6" r="1.4" />
      <circle cx="16.6" cy="16.6" r="1.4" />
    </StrokeIcon>
  ),
  "adbot-health-care": ({ className }) => (
    <StrokeIcon className={className}>
      <circle cx="12" cy="6.4" r="2.2" />
      <path d="M8.2 21v-4.2l-2-4.6a2.1 2.1 0 0 1 2-2.8h7.6a2.1 2.1 0 0 1 2 2.8l-2 4.6V21" />
      <path d="M12 10.8v3.4M10.3 12.5h3.4" />
    </StrokeIcon>
  ),
  "adbot-home-office": ({ className }) => (
    <StrokeIcon className={className}>
      <path d="m4 11 8-6.4L20 11" />
      <path d="M6.4 9.8V19h11.2V9.8" />
      <rect x="9.4" y="13.2" width="5.2" height="5.8" rx="0.8" />
    </StrokeIcon>
  ),
  "adbot-insurance-cover": ({ className }) => (
    <StrokeIcon className={className}>
      <path d="M12 3.6 5.2 6.2v5.6c0 4.3 2.8 7.2 6.8 8.6 4-1.4 6.8-4.3 6.8-8.6V6.2L12 3.6Z" />
      <path d="m8.8 12.2 2.2 2.2 4.3-4.4" />
    </StrokeIcon>
  ),
  "adbot-modern-workplace": ({ className }) => (
    <StrokeIcon className={className}>
      <path d="M4.4 20V8.4L12 4.6 19.6 8.4V20" />
      <path d="M9.2 20v-5.2h5.6V20" />
      <path d="M8.2 11h1.6M14.2 11h1.6M8.2 14h1.6M14.2 14h1.6" />
    </StrokeIcon>
  ),
  "adbot-team-together": ({ className }) => (
    <StrokeIcon className={className}>
      <circle cx="12" cy="7.2" r="2" />
      <circle cx="6.4" cy="8.4" r="1.6" />
      <circle cx="17.6" cy="8.4" r="1.6" />
      <path d="M8.6 19.4c.4-3 1.8-4.6 3.4-4.6s3 1.6 3.4 4.6" />
      <path d="M4.2 18.8c.3-2.2 1.4-3.4 2.6-3.4" />
      <path d="M19.8 18.8c-.3-2.2-1.4-3.4-2.6-3.4" />
    </StrokeIcon>
  ),
  "adbot-annual-hours": ({ className }) => (
    <StrokeIcon className={className}>
      <rect x="3.6" y="4.6" width="16.8" height="15.8" rx="2" />
      <path d="M8 3.6v2.8M16 3.6v2.8M3.6 9.2h16.8" />
      <path d="M8 13h.1M12 13h.1M16 13h.1M8 16.4h.1M12 16.4h.1" />
    </StrokeIcon>
  ),
  "adbot-travel-equals-work": ({ className }) => (
    <StrokeIcon className={className}>
      <path d="M3.6 15.2h16.8" />
      <path d="M6.2 15.2 8.8 8.6h6.4l2.6 6.6" />
      <path d="M9.4 8.6V6.8h5.2v1.8" />
      <circle cx="8.2" cy="17.4" r="1.3" />
      <circle cx="15.8" cy="17.4" r="1.3" />
      <path d="M14.6 5.4h4.2l1.2 2.4" />
    </StrokeIcon>
  ),
  "adbot-corporate-perks": ({ className }) => (
    <StrokeIcon className={className}>
      <path d="M4.4 10.2h15.2v9.4H4.4z" />
      <path d="M4.4 10.2 12 5.6l7.6 4.6" />
      <path d="M12 5.6v14" />
      <path d="M9.2 8.2c0-1.4 1.2-2.4 2.8-2.4" />
    </StrokeIcon>
  ),
};
