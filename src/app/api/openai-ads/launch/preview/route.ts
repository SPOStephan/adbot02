import { NextRequest } from "next/server";

import { parseOpenAIAdsActivationPreviewInput } from "@/lib/openai-ads/input";
import { previewOpenAIAdsActivation } from "@/lib/openai-ads/launch";
import {
  authenticateOpenAIAdsUser,
  openAIAdsErrorResponse,
  openAIAdsJson,
  readOpenAIAdsJson,
} from "@/lib/openai-ads/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await readOpenAIAdsJson(request);
    const command = parseOpenAIAdsActivationPreviewInput(body);
    const user = await authenticateOpenAIAdsUser();
    const result = await previewOpenAIAdsActivation({
      userId: user.id,
      launchId: command.launchId,
    });

    return openAIAdsJson({ ok: true, ...result });
  } catch (error) {
    return openAIAdsErrorResponse(error);
  }
}
