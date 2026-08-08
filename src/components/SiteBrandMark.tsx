import Link from "next/link";
import { BarChart3 } from "lucide-react";

import { getSiteBranding } from "@/lib/site-branding/branding";
import type { BrandSurface } from "@/lib/site-branding/types";

type Props = {
  /** Page background: picks the matching logo variant automatically. */
  tone: BrandSurface;
  href: string;
  size?: "sm" | "md";
  className?: string;
};

const SIZE = {
  sm: {
    iconBox: "size-9",
    icon: "size-4",
    imgHeight: "h-8",
    maxWidth: "max-w-[9rem]",
    text: "text-sm",
  },
  md: {
    iconBox: "size-10",
    icon: "size-5",
    imgHeight: "h-10",
    maxWidth: "max-w-[11rem]",
    text: "text-base",
  },
} as const;

export async function SiteBrandMark({
  tone,
  href,
  size = "md",
  className = "",
}: Props) {
  const branding = await getSiteBranding();
  const logoUrl =
    tone === "dark" ? branding.logoOnDarkUrl : branding.logoOnLightUrl;
  const metrics = SIZE[size];

  if (logoUrl) {
    return (
      <Link
        className={`inline-flex items-center ${className}`.trim()}
        href={href}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- public Supabase URL; avoid remotePatterns coupling */}
        <img
          alt="AdPilot"
          className={`${metrics.imgHeight} ${metrics.maxWidth} w-auto object-contain`}
          decoding="async"
          height={size === "sm" ? 32 : 40}
          src={logoUrl}
          width={size === "sm" ? 144 : 176}
        />
      </Link>
    );
  }

  return (
    <Link
      className={`flex items-center gap-3 font-extrabold ${metrics.text} ${className}`.trim()}
      href={href}
    >
      <span className={`grid ${metrics.iconBox} place-items-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/20`}>
        <BarChart3 className={metrics.icon} />
      </span>
      <span>AdPilot</span>
    </Link>
  );
}
