import { Bell } from "lucide-react";

import { CreditsSidebarBalance } from "@/components/CreditsSidebarBalance";
import { SignOutButton } from "@/components/SignOutButton";
import { getCreditBalanceForUser } from "@/lib/billing/credits";
import { createClient } from "@/lib/supabase/server";

export async function DashboardHeaderChrome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <DashboardHeaderFallback />;
  }

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
    <div className="ml-auto flex items-center gap-2 sm:gap-4">
      <span className="lg:hidden">
        <CreditsSidebarBalance
          balance={creditBalance ? creditBalance.balance : null}
          compact
        />
      </span>
      <span className="hidden max-w-56 truncate text-sm text-slate-500 sm:block">
        {user.email}
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
  );
}

export function DashboardHeaderFallback() {
  return (
    <div className="ml-auto flex items-center gap-3">
      <div className="hidden h-4 w-40 animate-pulse rounded bg-slate-100 sm:block" />
      <div className="size-9 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-9 w-24 animate-pulse rounded-lg bg-slate-100" />
    </div>
  );
}
