import { Suspense, type ReactNode } from "react";

import { DashboardAsideChrome, DashboardAsideFallback } from "@/components/DashboardAsideChrome";
import {
  DashboardHeaderChrome,
  DashboardHeaderFallback,
} from "@/components/DashboardHeaderChrome";
import { RequireDashboardAuth } from "@/components/RequireDashboardAuth";
import { SiteBrandMark } from "@/components/SiteBrandMark";
import { SiteFooter } from "@/components/SiteFooter";

type DashboardShellProps = {
  children: ReactNode;
};

function BrandMarkFallback({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-slate-100 ${
        size === "sm" ? "h-8 w-28" : "h-10 w-36"
      }`}
    />
  );
}

/**
 * Sync shell so sibling navigations are not blocked by layout data fetches.
 * Auth, credits and admin nav stream in via Suspense; page `loading.tsx` can
 * paint the destination header immediately.
 */
export function DashboardShell({ children }: DashboardShellProps) {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <Suspense fallback={null}>
        <RequireDashboardAuth />
      </Suspense>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white px-4 py-6 lg:flex lg:flex-col">
        <div className="px-2">
          <Suspense fallback={<BrandMarkFallback />}>
            <SiteBrandMark href="/dashboard" tone="light" />
          </Suspense>
        </div>
        <Suspense fallback={<DashboardAsideFallback />}>
          <DashboardAsideChrome />
        </Suspense>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
          <div className="flex min-h-16 items-center justify-between gap-4 px-5 sm:px-8">
            <div className="flex items-center gap-3 lg:hidden">
              <Suspense fallback={<BrandMarkFallback size="sm" />}>
                <SiteBrandMark href="/dashboard" size="sm" tone="light" />
              </Suspense>
            </div>
            <Suspense fallback={<DashboardHeaderFallback />}>
              <DashboardHeaderChrome />
            </Suspense>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] px-5 py-7 sm:px-8 lg:py-10">
          {children}
        </div>
        <SiteFooter tone="light" />
      </div>
    </main>
  );
}
