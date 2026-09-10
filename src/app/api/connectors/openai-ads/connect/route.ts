import { revalidatePath } from "next/cache";
import { NextRequest } from "next/server";

import { connectOpenAIAdsAccount } from "@/lib/openai-ads/connection";
import { parseOpenAIAdsConnectInput } from "@/lib/openai-ads/input";
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
    const deadlineAtMs = Date.now() + 150_000;
    const body = await readOpenAIAdsJson(request);
    const command = parseOpenAIAdsConnectInput(body);
    const user = await authenticateOpenAIAdsUser();
    const connection = await connectOpenAIAdsAccount({
      userId: user.id,
      apiKey: command.apiKey,
    });
    const sync = await syncOpenAIAdsAccount({
      userId: user.id,
      platformAccountId: connection.platformAccountId,
      deadlineAtMs,
    });

    revalidatePath("/dashboard", "page");
    revalidatePath("/dashboard/chatgpt-ads", "page");

    return openAIAdsJson(
      {
        ok: true,
        connection,
        sync: {
          status: sync.status,
          errorCode: sync.errorCode,
          counts: sync.counts,
        },
      },
      201,
    );
  } catch (error) {
    return openAIAdsErrorResponse(error);
  }
}
