import { redirect } from "next/navigation";

import { InspirationVaultClient } from "@/components/InspirationVaultClient";
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
    <>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
          Admin
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
          Inspiration Vault
        </h1>
        <p className="mt-2 max-w-2xl text-slate-500">
          Interne Referenzbilder und Notizen — nicht Teil der Kunden-Medienbibliothek.
        </p>
      </div>

      <div className="mt-8">
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
    </>
  );
}
