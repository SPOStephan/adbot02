import { controlJson } from "@/lib/meta/customer-control-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return controlJson(
    {
      ok: false,
      error: "selection_managed_by_meta",
      message:
        "Die Instagram-Auswahl wird ausschließlich im Meta-Onboarding verwaltet. Bitte verbinde Meta neu, um die Auswahl zu ändern.",
    },
    410,
  );
}
