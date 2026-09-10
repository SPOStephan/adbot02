import { revalidatePath } from "next/cache";
import { NextRequest } from "next/server";

import { parseOpenAIAdsLaunchInput } from "@/lib/openai-ads/input";
import { createActiveOpenAIAdsLaunch } from "@/lib/openai-ads/launch";
import {
  authenticateOpenAIAdsUser,
  openAIAdsErrorResponse,
  openAIAdsJson,
  readOpenAIAdsJson,
} from "@/lib/openai-ads/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: NextRequest) {
  try {
    const body = await readOpenAIAdsJson(request);
    const command = parseOpenAIAdsLaunchInput(body);
    const user = await authenticateOpenAIAdsUser();
    const result = await createActiveOpenAIAdsLaunch({
      userId: user.id,
      command,
    });

    revalidatePath("/dashboard/chatgpt-ads", "page");
    return openAIAdsJson({ ok: true, ...result }, result.alreadyExisted ? 200 : 201);
  } catch (error) {
    return openAIAdsErrorResponse(error);
  }
}
