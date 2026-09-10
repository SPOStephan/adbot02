import { NextRequest } from "next/server";

import { loadOpenAIAdsClient } from "@/lib/openai-ads/connection";
import {
  parseOpenAIAdsAccountCommand,
  parseOpenAIAdsGeoSearch,
} from "@/lib/openai-ads/input";
import {
  authenticateOpenAIAdsUser,
  openAIAdsErrorResponse,
  openAIAdsJson,
} from "@/lib/openai-ads/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await authenticateOpenAIAdsUser();
    const { platformAccountId } = parseOpenAIAdsAccountCommand({
      platformAccountId: request.nextUrl.searchParams.get("platformAccountId"),
    });
    const query = parseOpenAIAdsGeoSearch(
      request.nextUrl.searchParams.get("q"),
    );
    const loaded = await loadOpenAIAdsClient({
      platformAccountId,
      userId: user.id,
    });
    const locations = await loaded.client.searchGeoLocations(query);

    return openAIAdsJson({ ok: true, locations });
  } catch (error) {
    return openAIAdsErrorResponse(error);
  }
}
