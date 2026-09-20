import { redirect } from "next/navigation";

import { getKireadyAccessForUser } from "@/lib/kiready/entitlement";
import { createClient } from "@/lib/supabase/server";

/** Fails closed for anonymous users without blocking the layout shell. */
export async function RequireDashboardAuth() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const access = await getKireadyAccessForUser(user.id).catch(() => null);
  if (access?.linked && !access.allowDashboard) {
    redirect(`/auth/kiready/denied?reason=${encodeURIComponent(access.reason)}`);
  }

  return null;
}
