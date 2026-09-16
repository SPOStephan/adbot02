import type { CollectorStatus } from "./types";

const ALLOWED: Record<CollectorStatus, readonly CollectorStatus[]> = {
  fetched: ["reviewed", "rejected", "failed"],
  reviewed: ["ready_for_import", "fetched", "rejected"],
  ready_for_import: ["imported", "reviewed", "rejected", "failed"],
  imported: [],
  rejected: ["fetched"],
  failed: ["fetched", "rejected"],
};

export function canTransitionCollectorStatus(
  from: CollectorStatus,
  to: CollectorStatus,
): boolean {
  if (from === to) return true;
  return ALLOWED[from].includes(to);
}

export function collectorStatusLabel(status: CollectorStatus): string {
  switch (status) {
    case "fetched":
      return "Eingegangen";
    case "reviewed":
      return "Geprüft";
    case "ready_for_import":
      return "Bereit für Vault";
    case "imported":
      return "Im Vault";
    case "rejected":
      return "Verworfen";
    case "failed":
      return "Fehler";
  }
}
