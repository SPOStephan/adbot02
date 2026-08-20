import { HelpCircle, Settings } from "lucide-react";

import { CreditsSidebarBalance } from "@/components/CreditsSidebarBalance";
import { DashboardNav } from "@/components/DashboardNav";
import { isSiteAdmin } from "@/lib/auth/site-admin";
import { getCreditBalanceForUser } from "@/lib/billing/credits";
import { createClient } from "@/lib/supabase/server";

export async function DashboardAsideChrome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <DashboardAsideFallback />;
  }

  const isAdmin = await isSiteAdmin(user.id);
  let creditBalance: {
    balance: number;
    planName: string | null;
    periodEnd: string | null;
  } | null = null;
  try {
    creditBalance = await getCreditBalanceForUser(user.id);
  } catch {
    creditBalance = null;
  }

  return (
    <>
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
    </>
  );
}

export function DashboardAsideFallback() {
  return (
    <>
      <div className="mt-10 space-y-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            className="h-10 animate-pulse rounded-xl bg-slate-100"
            key={index}
          />
        ))}
      </div>
      <div className="mt-auto border-t border-slate-100 pt-5">
        <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
      </div>
    </>
  );
}
