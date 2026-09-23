import { normalizeCreativeTags } from "@/lib/ad-examples/structure";

import type { PlatformMotifCaptionStatus, PlatformMotifMetadata } from "./types";

function asCaptionStatus(
  value: unknown,
  summary: string | null,
): PlatformMotifCaptionStatus {
  if (
    value === "ready" ||
    value === "failed" ||
    value === "skipped" ||
    value === "pending"
  ) {
    return value;
  }
  return summary ? "ready" : "pending";
}

export function emptyPlatformMotifMetadata(
  tags: readonly string[] = [],
): PlatformMotifMetadata {
  return {
    contract_version: 1,
    library: "platform_motif_library",
    source_kind: "admin_platform_motif",
    never_launch_directly: true,
    clone_to_customer_for_launch: true,
    usable_one_to_one: true,
    usable_as_inspiration: true,
    tags: normalizeCreativeTags([...tags]),
    content_summary: null,
    caption_status: "pending",
  };
}

export function readPlatformMotifMetadata(
  value: unknown,
): PlatformMotifMetadata {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const summary =
    typeof record.content_summary === "string" && record.content_summary.trim()
      ? record.content_summary.trim().slice(0, 400)
      : null;
  return {
    ...emptyPlatformMotifMetadata(
      Array.isArray(record.tags) ? record.tags.map(String) : [],
    ),
    content_summary: summary,
    caption_status: asCaptionStatus(record.caption_status, summary),
  };
}
