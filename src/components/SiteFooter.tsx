import Link from "next/link";

import { MARKETING_SITE_URL } from "@/lib/site-urls";

type Props = {
  /** Dark footer for marketing/auth shells; light for dashboard. */
  tone?: "dark" | "light";
};

export function SiteFooter({ tone = "dark" }: Props) {
  const isDark = tone === "dark";

  return (
    <footer
      className={
        isDark
          ? "border-t border-white/10 bg-slate-950"
          : "border-t border-slate-200 bg-white"
      }
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-6 sm:flex-row sm:items-center sm:justify-between lg:px-8">
        <p
          className={
            isDark
              ? "text-xs text-slate-500"
              : "text-xs font-semibold text-slate-500"
          }
        >
          © {new Date().getFullYear()} Adbot / AdPilot
        </p>
        <nav
          aria-label="Rechtliches"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-bold"
        >
          <Link
            className={
              isDark
                ? "text-slate-300 transition hover:text-white"
                : "text-slate-700 transition hover:text-slate-950"
            }
            href={`${MARKETING_SITE_URL}/impressum`}
          >
            Impressum
          </Link>
          <Link
            className={
              isDark
                ? "text-slate-300 transition hover:text-white"
                : "text-slate-700 transition hover:text-slate-950"
            }
            href={`${MARKETING_SITE_URL}/datenschutz`}
          >
            Datenschutzerklärung
          </Link>
          <Link
            className={
              isDark
                ? "text-slate-300 transition hover:text-white"
                : "text-slate-700 transition hover:text-slate-950"
            }
            href={`${MARKETING_SITE_URL}/agb`}
          >
            AGB
          </Link>
        </nav>
      </div>
    </footer>
  );
}
