import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { DashboardShell } from "@/components/DashboardShell";
import { isSiteAdmin } from "@/lib/auth/site-admin";
import { getCreditBalanceForUser } from "@/lib/billing/credits";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
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
    <DashboardShell
      creditBalance={creditBalance}
      isAdmin={isAdmin}
      userEmail={user.email}
    >
      {children}
    </DashboardShell>
  );
}
