import { redirect } from "next/navigation";

import { OpenAIAdsGuideAdmin } from "@/components/OpenAIAdsGuideAdmin";
import { isSiteAdmin } from "@/lib/auth/site-admin";
import { getOpenAIAdsGuideAdmin } from "@/lib/openai-ads/guide";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OpenAIAdsGuideAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/chatgpt-ads-anleitung");
  }
  if (!(await isSiteAdmin(user.id))) {
    redirect("/dashboard");
  }

  const guide = await getOpenAIAdsGuideAdmin();

  return (
    <>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
          Admin
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
          ChatGPT-Ads-Anleitung
        </h1>
        <p className="mt-2 max-w-3xl text-slate-500">
          Screenshot-Schritte für die Kontoanbindung verwalten. Die Anleitung ist
          optional, öffnet sich in einem neuen Tab und kann ohne Deployment
          aktualisiert werden.
        </p>
      </div>

      <div className="mt-8">
        <OpenAIAdsGuideAdmin initialGuide={guide} />
      </div>
    </>
  );
}
