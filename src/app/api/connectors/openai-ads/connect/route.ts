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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await readOpenAIAdsJson(request);
    const command = parseOpenAIAdsConnectInput(body);
    const user = await authenticateOpenAIAdsUser();
    const connection = await connectOpenAIAdsAccount({
      userId: user.id,
      apiKey: command.apiKey,
    });

    revalidatePath("/dashboard", "page");
    revalidatePath("/dashboard/chatgpt-ads", "page");

    return openAIAdsJson(
      {
        ok: true,
        connection,
      },
      201,
    );
  } catch (error) {
    return openAIAdsErrorResponse(error);
  }
}
