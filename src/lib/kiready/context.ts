import "server-only";

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
  if (!response.ok) {
    throw new Error("KIready-Adbot-Kontext nicht erreichbar.");
  }
  const parsed = parseKireadyAdbotContext(await response.json());
  if (!parsed) {
    throw new Error("KIready-Adbot-Kontext ist ungültig.");
  }
  return parsed;
}
