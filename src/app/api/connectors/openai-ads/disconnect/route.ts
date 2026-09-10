import { revalidatePath } from "next/cache";
import { NextRequest } from "next/server";

import { disconnectOpenAIAdsAccount } from "@/lib/openai-ads/connection";
import { parseOpenAIAdsDisconnectInput } from "@/lib/openai-ads/input";
import {
  authenticateOpenAIAdsUser,
  openAIAdsErrorResponse,
  openAIAdsJson,
  readOpenAIAdsJson,
} from "@/lib/openai-ads/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await readOpenAIAdsJson(request);
    const command = parseOpenAIAdsDisconnectInput(body);
    const user = await authenticateOpenAIAdsUser();
    const result = await disconnectOpenAIAdsAccount({
      userId: user.id,
      platformAccountId: command.platformAccountId,
    });

    revalidatePath("/dashboard", "page");
    revalidatePath("/dashboard/chatgpt-ads", "page");

    return openAIAdsJson({
      ok: true,
      status: result.disconnected ? "disconnected" : "already_disconnected",
    });
  } catch (error) {
    return openAIAdsErrorResponse(error);
  }
}
