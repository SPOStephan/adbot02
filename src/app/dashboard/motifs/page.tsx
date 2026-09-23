import { redirect } from "next/navigation";

import { PlatformMotifLibraryAdmin } from "@/components/PlatformMotifLibraryAdmin";
import { isSiteAdmin } from "@/lib/auth/site-admin";
import { listPlatformMotifs } from "@/lib/platform-library/service";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PlatformMotifLibraryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/motifs");
  }
  if (!(await isSiteAdmin(user.id))) {
    redirect("/dashboard");
  }

  let motifs: Awaited<ReturnType<typeof listPlatformMotifs>> = {
    motifs: [],
    total: 0,
  };
  try {
    motifs = await listPlatformMotifs({ limit: 80 });
  } catch (error) {
    console.error("[motifs] list failed", error);
  }

  return (
    <>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
          Admin
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
          Motivbibliothek
        </h1>
        <p className="mt-2 max-w-3xl text-slate-500">
          Globale, handkuratierte Motive — meist KI-generiert — aus denen Adbot
          sich bedienen darf. Anders als die Werbebeispiele darf Adbot diese
          Bilder eins zu eins übernehmen oder als Inspirationsquelle neu
          gestalten. Kunden sehen die Bibliothek nicht. Ein Meta-Launch nutzt
          immer nur eine Kopie in der isolierten Kundenbibliothek.
        </p>
      </div>

      <div className="mt-8">
        <PlatformMotifLibraryAdmin
          initialMotifs={motifs.motifs}
          initialTotal={motifs.total}
        />
      </div>
    </>
  );
}
