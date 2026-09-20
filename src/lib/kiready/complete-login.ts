import "server-only";

import { NextResponse } from "next/server";

import { clearOidcFlowCookies } from "@/lib/kiready/cookies";
import { decideAccessFromContext, denialMessage } from "@/lib/kiready/entitlement";
import { persistKireadyLink } from "@/lib/kiready/identities";
import { establishAdbotSession } from "@/lib/kiready/session";
import type { KireadyOidcEnv } from "@/lib/kiready/env";
import type { KireadyAdbotContext } from "@/lib/kiready/types";
import { APP_SITE_URL } from "@/lib/site-urls";
import { normalizeSafeNextPath } from "@/lib/auth/safe-next-path";

export function kireadyLoginErrorRedirect(message: string) {
  const url = new URL("/login", `${APP_SITE_URL}/`);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url);
}

export async function completeKireadyLogin(input: {
  env: KireadyOidcEnv;
  context: KireadyAdbotContext;
  userId: string;
  email: string;
  next: string;
  tokens: { accessToken: string; refreshToken: string | null; expiresIn: number | null };
  secure: boolean;
}): Promise<NextResponse> {
  const access = decideAccessFromContext(input.context);
  if (!access.allowDashboard) {
    return kireadyLoginErrorRedirect(denialMessage(access.reason));
  }

  await persistKireadyLink({
    env: input.env,
    context: input.context,
    userId: input.userId,
    tokens: input.tokens,
  });
  await establishAdbotSession(input.email);

  const response = NextResponse.redirect(
    new URL(normalizeSafeNextPath(input.next), `${APP_SITE_URL}/`),
  );
  clearOidcFlowCookies(response, input.secure);
  return response;
}
