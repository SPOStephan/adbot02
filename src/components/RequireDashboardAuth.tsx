import { redirect } from "next/navigation";

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

  return null;
}
