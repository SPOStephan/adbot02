import { revalidatePath } from "next/cache";
import { NextRequest } from "next/server";

import { parseOpenAIAdsAccountCommand } from "@/lib/openai-ads/input";
import {
  authenticateOpenAIAdsUser,
  openAIAdsErrorResponse,
  openAIAdsJson,
  readOpenAIAdsJson,
} from "@/lib/openai-ads/route";
import { syncOpenAIAdsAccount } from "@/lib/openai-ads/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: NextRequest) {
  try {
    const body = await readOpenAIAdsJson(request);
    const command = parseOpenAIAdsAccountCommand(body);
    const user = await authenticateOpenAIAdsUser();
    const result = await syncOpenAIAdsAccount({
      userId: user.id,
      platformAccountId: command.platformAccountId,
    });

    revalidatePath("/dashboard", "page");
    revalidatePath("/dashboard/chatgpt-ads", "page");

    if (result.outcome === "blocked") {
      return openAIAdsJson(
        { ok: false, error: result.errorCode, status: result.status },
        429,
      );
    }
    return openAIAdsJson(
      {
        ok: result.outcome === "success",
        status: result.status,
        errorCode: result.errorCode,
        counts: result.counts,
      },
      result.outcome === "success" ? 200 : 502,
    );
  } catch (error) {
    return openAIAdsErrorResponse(error);
  }
}
