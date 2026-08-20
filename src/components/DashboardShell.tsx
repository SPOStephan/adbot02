import { Bell, HelpCircle, Settings } from "lucide-react";
import type { ReactNode } from "react";

import { CreditsSidebarBalance } from "@/components/CreditsSidebarBalance";
import { DashboardNav } from "@/components/DashboardNav";
import { SignOutButton } from "@/components/SignOutButton";
import { SiteBrandMark } from "@/components/SiteBrandMark";
import { SiteFooter } from "@/components/SiteFooter";

type CreditProps = {
  balance: number | null;
  planName?: string | null;
  periodEnd?: string | null;
};

type DashboardShellProps = {
  userEmail: string | null | undefined;
  isAdmin: boolean;
  creditBalance: CreditProps | null;
  children: ReactNode;
};

export function DashboardShell({
  userEmail,
  isAdmin,
  creditBalance,
  children,
}: DashboardShellProps) {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white px-4 py-6 lg:flex lg:flex-col">
        <div className="px-2">
          <SiteBrandMark href="/dashboard" tone="light" />
        </div>

        <DashboardNav isAdmin={isAdmin} />

        <div className="mt-auto space-y-1 border-t border-slate-100 pt-5">
          <CreditsSidebarBalance
            balance={creditBalance ? creditBalance.balance : null}
            planName={creditBalance?.planName ?? null}
            periodEnd={creditBalance?.periodEnd ?? null}
          />
          <span className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-500">
            <HelpCircle className="size-5" />
            Hilfe
          </span>
          <span className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-500">
            <Settings className="size-5" />
            Einstellungen
          </span>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
          <div className="flex min-h-16 items-center justify-between gap-4 px-5 sm:px-8">
            <div className="flex items-center gap-3 lg:hidden">
              <SiteBrandMark href="/dashboard" size="sm" tone="light" />
            </div>
            <div className="ml-auto flex items-center gap-2 sm:gap-4">
              <span className="lg:hidden">
                <CreditsSidebarBalance
                  balance={creditBalance ? creditBalance.balance : null}
                  compact
                />
              </span>
              <span className="hidden max-w-56 truncate text-sm text-slate-500 sm:block">
                {userEmail}
              </span>
              <button
                aria-label="Benachrichtigungen"
                className="grid size-9 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100"
                type="button"
              >
                <Bell className="size-5" />
              </button>
              <SignOutButton />
            </div>
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
