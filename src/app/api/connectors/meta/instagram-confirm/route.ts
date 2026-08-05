import { revalidatePath } from "next/cache";
import { NextRequest } from "next/server";

import {
  confirmInstagramAccounts,
  listInstagramConfirmCandidates,
} from "@/lib/meta/instagram-confirm";
import { controlJson, readControlJson } from "@/lib/meta/customer-control-route";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  return user.id;
}

export async function GET() {
  const userId = await requireUserId();

  if (!userId) {
    return controlJson({ ok: false, error: "unauthorized" }, 401);
  }

  try {
    const result = await listInstagramConfirmCandidates(userId);
    return controlJson({
      ok: true,
      candidates: result.candidates,
      alreadySelectedIds: result.alreadySelectedIds,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown";
    const status =
      code === "meta_not_connected"
        ? 404
        : code === "token_expired"
          ? 409
          : 500;
    return controlJson({ ok: false, error: code }, status);
  }
}

export async function POST(request: NextRequest) {
  const userId = await requireUserId();

  if (!userId) {
    return controlJson({ ok: false, error: "unauthorized" }, 401);
  }

  try {
    const body = await readControlJson(request);
    const selectedIds = Array.isArray(
      body && typeof body === "object" && "selectedIds" in body
        ? (body as { selectedIds?: unknown }).selectedIds
        : null,
    )
      ? ((body as { selectedIds: unknown[] }).selectedIds as unknown[])
          .filter((value): value is string => typeof value === "string")
      : [];

    const accounts = await confirmInstagramAccounts({
      userId,
      selectedIds,
    });
    revalidatePath("/dashboard", "page");
    return controlJson({
      ok: true,
      instagramAccounts: accounts,
    });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) {
      const serviceError = error as { status: number; code?: string; message?: string };
      return controlJson(
        {
          ok: false,
          error: serviceError.code ?? "invalid_request",
          message: serviceError.message,
        },
        serviceError.status,
      );
    }

    const code = error instanceof Error ? error.message : "unknown";
    const status =
      code === "empty_selection" || code === "invalid_selection"
        ? 400
        : code === "meta_not_connected"
          ? 404
          : code === "token_expired"
            ? 409
            : 500;
    return controlJson({ ok: false, error: code }, status);
  }
}
