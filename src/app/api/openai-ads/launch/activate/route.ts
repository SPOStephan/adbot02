import { revalidatePath } from "next/cache";
import { NextRequest } from "next/server";

import { parseOpenAIAdsActivationInput } from "@/lib/openai-ads/input";
import { activateOpenAIAdsLaunch } from "@/lib/openai-ads/launch";
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
    const command = parseOpenAIAdsActivationInput(body);
    const user = await authenticateOpenAIAdsUser();
    const result = await activateOpenAIAdsLaunch({
      userId: user.id,
      launchId: command.launchId,
      previewToken: command.previewToken,
    });

    revalidatePath("/dashboard/chatgpt-ads", "page");
    revalidatePath("/dashboard", "page");
    return openAIAdsJson({ ok: true, ...result });
  } catch (error) {
    return openAIAdsErrorResponse(error);
  }
}
