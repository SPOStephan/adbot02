import type { FreebieMetaTracking } from "./types";
import { defaultFreebieMetaTracking } from "./types";

export type MetaPixelSoftApplyAction =
  | "set_and_enable"
  | "ensure_enabled"
  | "skip";

export type MetaPixelSoftApplyResult = {
  action: MetaPixelSoftApplyAction;
  next: FreebieMetaTracking;
};

export function softApplyMetaPixel(
  current: FreebieMetaTracking | null | undefined,
  pixelId: string,
  options?: { eventName?: string },
): MetaPixelSoftApplyResult {
  const base = {
    ...defaultFreebieMetaTracking,
    ...(current ?? {}),
  };
  const incoming = pixelId.trim();
  if (!/^\d{5,25}$/.test(incoming)) {
    return { action: "skip", next: base };
  }

  const existing = base.pixelId.trim();
  if (!existing) {
    const eventName =
      (options?.eventName?.trim() || base.eventName.trim() || "Lead").replace(
        /[^A-Za-z0-9_]/g,
        "",
      ) || "Lead";
    return {
      action: "set_and_enable",
      next: {
        ...base,
        enabled: true,
        pixelId: incoming,
        eventName,
      },
    };
  }

  if (existing === incoming) {
    if (base.enabled) {
      return { action: "skip", next: base };
    }
    return {
      action: "ensure_enabled",
      next: {
        ...base,
        enabled: true,
        pixelId: incoming,
      },
    };
  }

  return { action: "skip", next: base };
}
