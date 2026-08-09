import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ImageIcon } from "lucide-react";

import { MediaLibraryClient } from "@/components/MediaLibraryClient";
import { SignOutButton } from "@/components/SignOutButton";
import { SiteFooter } from "@/components/SiteFooter";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CreativesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/creatives");
  }

  const { data: metaAccount } = await supabase
    .from("platform_accounts")
    .select("id")
    .eq("user_id", user.id)
    .eq("platform", "meta")
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();

  const [{ data: assets }, { data: profiles }] = await Promise.all([
    metaAccount
      ? supabase
          .from("brand_assets")
          .select(
            "id,original_filename,width,height,source_type,status,meta_image_hash,created_at,library_scope",
          )
          .eq("user_id", user.id)
          .eq("platform_account_id", metaAccount.id)
          .eq("library_scope", "CUSTOMER")
          .order("created_at", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [] as const }),
    metaAccount
      ? supabase
          .from("brand_profiles")
          .select("id,brand_name,status")
          .eq("user_id", user.id)
          .eq("platform_account_id", metaAccount.id)
          .eq("status", "ACTIVE")
          .order("activated_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] as const }),
  ]);

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-blue-600 text-white">
              <ImageIcon className="size-5" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                Dashboard · Media Library
              </p>
              <h1 className="text-lg font-extrabold">Creatives</h1>
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
        <MediaLibraryClient
          assets={(assets ?? []).map(asset => ({
            id: String(asset.id),
            originalFilename: String(asset.original_filename ?? "Creative"),
            width: typeof asset.width === "number" ? asset.width : null,
            height: typeof asset.height === "number" ? asset.height : null,
            sourceType: String(asset.source_type ?? "UPLOADED"),
            status: String(asset.status ?? "READY"),
            metaImageHashPresent: Boolean(asset.meta_image_hash),
            createdAt: String(asset.created_at),
          }))}
          brandProfiles={(profiles ?? []).map(profile => ({
            id: String(profile.id),
            brandName: String(profile.brand_name ?? "Brand"),
          }))}
          metaConnected={Boolean(metaAccount)}
        />
      </div>
      <SiteFooter />
    </main>
  );
}
