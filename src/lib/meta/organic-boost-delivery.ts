/**
 * Single delivery truth for Beitrag-Push.
 *
 * Meta keeps campaign.status/effective_status ACTIVE when only ads or ad sets
 * are PAUSED. "Boost aktiv" / plan SUCCEEDED must never mean campaign-only.
 */

export type OrganicBoostDeliveryTree = {
  campaignConfiguredActive: boolean;
  adSetConfiguredActive: boolean;
  adConfiguredActive: boolean;
  /** True when we successfully inspected at least one ad set and one ad. */
  treeVerified: boolean;
};

export function isTerminalDeliveryOff(
  status: string | null | undefined,
  effectiveStatus: string | null | undefined,
): boolean {
  const configured = (status ?? "").toUpperCase();
  const effective = (effectiveStatus ?? "").toUpperCase();
  return (
    configured === "DELETED" ||
    configured === "ARCHIVED" ||
    effective === "DELETED" ||
    effective === "ARCHIVED" ||
    effective === "COMPLETED" ||
    effective === "CAMPAIGN_COMPLETED"
  );
}

/** Configured delivery switch is off (Meta `status`), ignoring parent-pause effective states. */
export function isConfiguredDeliveryPaused(
  status: string | null | undefined,
  effectiveStatus?: string | null | undefined,
): boolean {
  const configured = (status ?? "").toUpperCase();
  if (
    configured === "DELETED" ||
    configured === "ARCHIVED" ||
    isTerminalDeliveryOff(status, effectiveStatus)
  ) {
    return false;
  }
  return configured === "PAUSED";
}

export function isConfiguredDeliveryActive(
  status: string | null | undefined,
): boolean {
  return (status ?? "").toUpperCase() === "ACTIVE";
}

/**
 * Overlay for local campaigns.effective_status.
 * Campaign Meta ACTIVE + paused children → AD_PAUSED / ADSET_PAUSED.
 * Campaign Meta ACTIVE + children not verified → DELIVERY_UNVERIFIED (never "aktiv").
 */
export function overlayCampaignEffectiveForDelivery(input: {
  campaignStatus: string | null | undefined;
  campaignEffectiveStatus: string | null | undefined;
  adSetStatuses: ReadonlyArray<{
    status: string | null;
    effectiveStatus: string | null;
  }>;
  adStatuses: ReadonlyArray<{
    status: string | null;
    effectiveStatus: string | null;
  }>;
  childrenFetched: boolean;
}): string {
  const campaignEffective = (
    input.campaignEffectiveStatus ??
    input.campaignStatus ??
    ""
  ).toUpperCase();
  const campaignStatus = (input.campaignStatus ?? "").toUpperCase();

  if (
    isTerminalDeliveryOff(input.campaignStatus, input.campaignEffectiveStatus)
  ) {
    return campaignEffective || campaignStatus || "COMPLETED";
  }

  if (
    campaignStatus === "PAUSED" ||
    campaignEffective === "PAUSED" ||
    campaignEffective === "CAMPAIGN_PAUSED"
  ) {
    return campaignEffective || "PAUSED";
  }

  const looksCampaignActive =
    campaignStatus === "ACTIVE" || campaignEffective === "ACTIVE";
  if (!looksCampaignActive) {
    return campaignEffective || campaignStatus || "UNKNOWN";
  }

  if (!input.childrenFetched) {
    return "DELIVERY_UNVERIFIED";
  }

  const liveAdSets = input.adSetStatuses.filter(
    (row) => !isTerminalDeliveryOff(row.status, row.effectiveStatus),
  );
  const liveAds = input.adStatuses.filter(
    (row) => !isTerminalDeliveryOff(row.status, row.effectiveStatus),
  );

  // Incomplete tree cannot be "active".
  if (liveAdSets.length < 1 || liveAds.length < 1) {
    return "DELIVERY_UNVERIFIED";
  }

  if (liveAds.some((row) => isConfiguredDeliveryPaused(row.status))) {
    return "AD_PAUSED";
  }
  if (liveAdSets.some((row) => isConfiguredDeliveryPaused(row.status))) {
    return "ADSET_PAUSED";
  }

  const adsActive = liveAds.every((row) =>
    isConfiguredDeliveryActive(row.status),
  );
  const adSetsActive = liveAdSets.every((row) =>
    isConfiguredDeliveryActive(row.status),
  );
  if (!adsActive || !adSetsActive) {
    return "DELIVERY_UNVERIFIED";
  }

  return "ACTIVE";
}

/** Hard invariant: delivery is active only when the full tree is verified ACTIVE. */
export function isOrganicBoostDeliveryActive(
  tree: OrganicBoostDeliveryTree,
): boolean {
  return (
    tree.treeVerified &&
    tree.campaignConfiguredActive &&
    tree.adSetConfiguredActive &&
    tree.adConfiguredActive
  );
}

export function deliveryLabelForEffectiveStatus(
  effective: string,
): { deliveryState: "active" | "paused" | "waiting_meta" | "completed" | "starting"; deliveryLabel: string } | null {
  const value = effective.toUpperCase();
  if (
    value === "COMPLETED" ||
    value === "CAMPAIGN_COMPLETED" ||
    value === "ARCHIVED"
  ) {
    return {
      deliveryState: "completed",
      deliveryLabel: "Laufzeit beendet",
    };
  }
  if (value === "DELETED") {
    return {
      deliveryState: "completed",
      deliveryLabel: "Bei Meta nicht mehr verfügbar — lokal behalten",
    };
  }
  if (
    value === "PENDING_REVIEW" ||
    value === "IN_PROCESS" ||
    value === "PREAPPROVED" ||
    value === "PENDING"
  ) {
    return {
      deliveryState: "waiting_meta",
      deliveryLabel: "Wartet auf Freigabe durch Meta",
    };
  }
  if (value === "DELIVERY_UNVERIFIED") {
    return {
      deliveryState: "starting",
      deliveryLabel:
        "Kampagne sichtbar — Anzeigen-Status wird geprüft/aktiviert",
    };
  }
  if (
    value === "PAUSED" ||
    value === "CAMPAIGN_PAUSED" ||
    value === "ADSET_PAUSED" ||
    value === "AD_PAUSED"
  ) {
    return {
      deliveryState: "paused",
      deliveryLabel:
        value === "AD_PAUSED" || value === "ADSET_PAUSED"
          ? "Pausiert (Anzeige/AdSet noch aus) — Adbot schaltet auf Aktiv"
          : "Pausiert (noch nicht aktiviert) — Adbot schaltet auf Aktiv; Meta-Prüfung folgt erst danach",
    };
  }
  if (value === "ACTIVE") {
    return {
      deliveryState: "active",
      deliveryLabel: "Boost aktiv",
    };
  }
  return null;
}
