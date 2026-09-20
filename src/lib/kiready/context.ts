import "server-only";

import { resolveKireadyContextError } from "@/lib/kiready/errors";
import {
  hasPersonalAdbotUse,
  parseKireadyAdbotContext,
} from "@/lib/kiready/parse";
import type { KireadyAdbotContext } from "@/lib/kiready/types";

export { hasPersonalAdbotUse, parseKireadyAdbotContext };

export async function fetchKireadyAdbotContext(input: {
  contextUrl: string;
  accessToken: string;
}): Promise<KireadyAdbotContext> {
  const response = await fetch(input.contextUrl, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${input.accessToken}`,
    },
    cache: "no-store",
  });
  const raw = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw resolveKireadyContextError(response.status, raw);
  }
  const parsed = parseKireadyAdbotContext(raw);
  if (!parsed) {
    throw new Error("KIready-Adbot-Kontext ist ungültig.");
  }
  return parsed;
}
