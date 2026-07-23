'use client';

import { useState } from "react";
import { LogOut } from "lucide-react";

import { MARKETING_SITE_URL } from "@/lib/site-urls";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.assign(MARKETING_SITE_URL);
  }

  return (
    <button
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 disabled:opacity-50"
      disabled={loading}
      onClick={handleSignOut}
      type="button"
    >
      <LogOut className="size-4" />
      {loading ? "Wird abgemeldet …" : "Abmelden"}
    </button>
  );
}
