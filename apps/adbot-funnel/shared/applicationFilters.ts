import type { ApplicationRecord, ApplicationStatus } from "./funnel";
import { isBuiltinContactFieldKey } from "./contactFields";

export type ApplicationFilter = ApplicationStatus | "all" | "active";

export function matchesApplicationStatus(status: ApplicationStatus, filter: ApplicationFilter) {
  if (filter === "all") return true;
  if (filter === "active") return status === "reviewing" || status === "contacted";
  return status === filter;
}

export function filterApplications(
  applications: ApplicationRecord[],
  options: {
    status: ApplicationFilter;
    search: string;
    funnelTitles?: ReadonlyMap<string, string>;
  },
) {
  const needle = options.search.trim().toLowerCase();
  return applications.filter(application => {
    if (!matchesApplicationStatus(application.status, options.status)) return false;
    if (!needle) return true;
    return [
      application.contact.name,
      application.contact.company,
      application.contact.email,
      application.contact.phone,
      ...Object.entries(application.contact)
        .filter(([key]) => !isBuiltinContactFieldKey(key))
        .map(([, value]) => value),
      application.id,
      application.funnelSlug,
      options.funnelTitles?.get(application.funnelSlug),
    ].some(value => value?.toLowerCase().includes(needle));
  });
}

export function getApplicationTotals(applications: ApplicationRecord[]) {
  return {
    all: applications.length,
    new: applications.filter(application => application.status === "new").length,
    active: applications.filter(application => matchesApplicationStatus(application.status, "active")).length,
  };
}

export type ApplicationSortKey = "contact" | "funnel" | "contactData" | "createdAt" | "status" | "rating" | "answers";
export type ApplicationSortDirection = "asc" | "desc";
export type ApplicationSort = { key: ApplicationSortKey; direction: ApplicationSortDirection };

/** Default overview order: newest entry on top, regardless of funnel. */
export const DEFAULT_APPLICATION_SORT: ApplicationSort = { key: "createdAt", direction: "desc" };

const STATUS_ORDER: Record<ApplicationStatus, number> = { new: 0, reviewing: 1, contacted: 2, hired: 3, rejected: 4 };

type SortValue = string | number | undefined;

function sortValue(application: ApplicationRecord, key: ApplicationSortKey, funnelTitles?: ReadonlyMap<string, string>): SortValue {
  switch (key) {
    case "contact": return application.contact.name?.trim() || undefined;
    case "funnel": return funnelTitles?.get(application.funnelSlug) ?? application.funnelSlug;
    case "contactData": return application.contact.email?.trim() || application.contact.phone?.trim() || undefined;
    case "createdAt": return Date.parse(application.createdAt) || 0;
    case "status": return STATUS_ORDER[application.status];
    case "rating": return application.leadQuality === "good" ? 1 : application.leadQuality === "bad" ? 0 : undefined;
    case "answers": return Object.keys(application.answers).length;
  }
}

function compareValues(a: SortValue, b: SortValue) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "de", { sensitivity: "base", numeric: true });
}

/** Clicking a header selects that column; clicking the active column flips its direction. */
export function nextApplicationSort(current: ApplicationSort, key: ApplicationSortKey): ApplicationSort {
  if (current.key === key) return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  return { key, direction: key === "createdAt" ? "desc" : "asc" };
}

/**
 * Sorts a copy of the list by the chosen column. Empty values always go last,
 * and ties fall back to newest-first so the default order stays stable.
 */
export function sortApplications(
  applications: ApplicationRecord[],
  sort: ApplicationSort = DEFAULT_APPLICATION_SORT,
  funnelTitles?: ReadonlyMap<string, string>,
) {
  const factor = sort.direction === "asc" ? 1 : -1;
  return applications
    .map(application => ({ application, value: sortValue(application, sort.key, funnelTitles), createdAt: Date.parse(application.createdAt) || 0 }))
    .sort((a, b) => {
      if (a.value === undefined && b.value !== undefined) return 1;
      if (b.value === undefined && a.value !== undefined) return -1;
      const primary = a.value === undefined || b.value === undefined ? 0 : compareValues(a.value, b.value) * factor;
      return primary || b.createdAt - a.createdAt;
    })
    .map(entry => entry.application);
}
