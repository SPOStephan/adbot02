/**
 * Beitragskandidaten list: only open / Freigeben-held posts.
 * Once a boost left held state or is already Meta-linked, it belongs under Kampagnen.
 */

export function isHeldOrganicBoostNotBefore(
  notBefore: string | null | undefined,
): boolean {
  if (!notBefore) return false;
  if (notBefore.toLowerCase() === "infinity") return true;
  const ms = Date.parse(notBefore);
  // Far-future hold (canary) — treat like infinity.
  return Number.isFinite(ms) && ms > Date.now() + 10 * 365 * 24 * 3600 * 1000;
}

export function isHeldOrganicBoostPlan(input: {
  status?: string | null;
  notBefore?: string | null;
}): boolean {
  const status = (input.status ?? "").toUpperCase();
  if (status === "HELD") return true;
  return isHeldOrganicBoostNotBefore(input.notBefore);
}

/** Keep in "Neu seit Ausgangsbestand" only if unboosted or still awaiting Freigeben. */
export function shouldListAsContentCandidate(input: {
  heldPlan?: {
    status?: string | null;
    notBefore?: string | null;
  } | null;
}): boolean {
  if (!input.heldPlan) return true;
  return isHeldOrganicBoostPlan(input.heldPlan);
}
