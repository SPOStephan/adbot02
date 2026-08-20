import { redirect } from "next/navigation";

import { SiteLogoEditor } from "@/components/SiteLogoEditor";
import { isSiteAdmin } from "@/lib/auth/site-admin";
import { getSiteBranding } from "@/lib/site-branding/branding";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DashboardBrandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/branding");
  }

  if (!(await isSiteAdmin(user.id))) {
    redirect("/dashboard");
  }

  const branding = await getSiteBranding();

  return (
    <>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
          Admin
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Branding</h1>
        <p className="mt-2 max-w-2xl text-slate-500">
          Favicon und Site-Logo für Adbot.one (öffentliche Oberfläche und Portal).
        </p>
      </div>

      <div className="mt-8">
        <SiteLogoEditor branding={branding} />
      </div>
    </>
  );
}
