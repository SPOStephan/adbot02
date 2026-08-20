import type { FunnelMetaTracking } from "./funnel";

export type MetaPixelSoftApplyAction =
  | "set_and_enable"
  | "ensure_enabled"
  | "skip";

export type MetaPixelSoftApplyResult = {
  action: MetaPixelSoftApplyAction;
  next: FunnelMetaTracking;
};

/**
 * Soft-apply a portal-confirmed Meta Pixel onto Funnel metaTracking.
 * - empty pixelId → set ID, enable, keep eventName/trigger (or default Lead)
 * - same pixelId → ensure enabled
 * - different non-empty pixelId → skip (never overwrite a manual other pixel)
 */
export function softApplyMetaPixel(
  current: FunnelMetaTracking,
  pixelId: string,
  options?: { eventName?: string },
): MetaPixelSoftApplyResult {
  const incoming = pixelId.trim();
  if (!/^\d{5,25}$/.test(incoming)) {
    return { action: "skip", next: current };
  }

  const existing = current.pixelId.trim();
  if (!existing) {
    const eventName =
      (options?.eventName?.trim() || current.eventName.trim() || "Lead").replace(
        /[^A-Za-z0-9_]/g,
        "",
      ) || "Lead";
    return {
      action: "set_and_enable",
      next: {
        ...current,
        enabled: true,
        pixelId: incoming,
        eventName,
      },
    };
  }

  if (existing === incoming) {
    if (current.enabled) {
      return { action: "skip", next: current };
    }
    return {
      action: "ensure_enabled",
      next: {
        ...current,
        enabled: true,
        pixelId: incoming,
      },
    };
  }

  return { action: "skip", next: current };
}

/** Map portal Ads custom_event_type (e.g. LEAD) to Pixel/CAPI event_name (Lead). */
export function mapPortalCustomEventToFunnelEventName(
  customEventType: string | null | undefined,
): string {
  const raw = (customEventType ?? "").trim();
  if (!raw) return "Lead";
  if (raw.toUpperCase() === "LEAD") return "Lead";
  // Meta Ads often uses ALL_CAPS; Pixel/CAPI standard events use Title Case.
  if (/^[A-Z][A-Z0-9_]*$/.test(raw)) {
    return raw.charAt(0) + raw.slice(1).toLowerCase();
  }
  if (/^[A-Za-z][A-Za-z0-9_]*$/.test(raw)) return raw;
  return "Lead";
}
