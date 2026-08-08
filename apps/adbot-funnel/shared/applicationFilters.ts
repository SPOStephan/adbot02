import type { ApplicationRecord, ApplicationStatus } from "./funnel";

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
