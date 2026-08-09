import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, EyeOff } from "lucide-react";

import { InspirationVaultClient } from "@/components/InspirationVaultClient";
import { SignOutButton } from "@/components/SignOutButton";
import { SiteFooter } from "@/components/SiteFooter";
import { isSiteAdmin } from "@/lib/auth/site-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function InspirationVaultPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/inspiration");
  }

  if (!(await isSiteAdmin(user.id))) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();
  const { data: assets } = await admin
    .from("brand_assets")
    .select("id,original_filename,width,height,metadata,created_at")
    .eq("library_scope", "INSPIRATION")
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-slate-900 text-white">
              <EyeOff className="size-5" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                Dashboard · Admin
              </p>
              <h1 className="text-lg font-extrabold">Inspiration Vault</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-950"
              href="/dashboard"
            >
              <ArrowLeft className="size-3.5" />
              Übersicht
            </Link>
            <SignOutButton />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-8">
        <InspirationVaultClient
          assets={(assets ?? []).map(asset => {
            const metadata =
              asset.metadata && typeof asset.metadata === "object"
                ? (asset.metadata as Record<string, unknown>)
                : {};
            return {
              id: String(asset.id),
              originalFilename: String(asset.original_filename ?? "Inspiration"),
              width: typeof asset.width === "number" ? asset.width : null,
              height: typeof asset.height === "number" ? asset.height : null,
              note: typeof metadata.note === "string" ? metadata.note : null,
              createdAt: String(asset.created_at),
            };
          })}
        />
      </div>
      <SiteFooter />
    </main>
  );
}
