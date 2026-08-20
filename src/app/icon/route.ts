import { serveSiteFaviconResponse } from "@/lib/site-branding/serve-favicon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return serveSiteFaviconResponse();
}
