import { Bell, ExternalLink } from "lucide-react";

import { CreditsSidebarBalance } from "@/components/CreditsSidebarBalance";
import { SignOutButton } from "@/components/SignOutButton";
import { getCreditBalanceForUser } from "@/lib/billing/credits";
import { getKireadyAccessForUser } from "@/lib/kiready/entitlement";
import { kireadyPortalUrl } from "@/lib/kiready/public";
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

  const access = await getKireadyAccessForUser(user.id).catch(() => null);

  return (
    <div className="ml-auto flex items-center gap-2 sm:gap-4">
      <span className="lg:hidden">
        <CreditsSidebarBalance
          balance={creditBalance ? creditBalance.balance : null}
          compact
        />
      </span>
      {access?.reason === "past_due" ? (
        <span className="hidden rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900 sm:inline">
          Zahlung überfällig
        </span>
      ) : null}
      <a
        className="hidden items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950 sm:inline-flex"
        href={kireadyPortalUrl()}
        rel="noreferrer"
        target="_blank"
      >
        KIready öffnen
        <ExternalLink className="size-3.5" />
      </a>
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
