import { describe, expect, it } from "vitest";
import { filterApplications, getApplicationTotals, matchesApplicationStatus } from "@shared/applicationFilters";
import type { ApplicationRecord, ApplicationStatus } from "@shared/funnel";

function application(id: string, status: ApplicationStatus, name: string, funnelSlug = "karriere"): ApplicationRecord {
  return {
    id,
    funnelId: "10000000-0000-4000-8000-000000000001",
    funnelSlug,
    status,
    answers: {},
    contact: { name, email: `${name.toLowerCase()}@example.org` },
    consentAt: "2026-07-27T10:00:00.000Z",
    utm: {},
    createdAt: "2026-07-27T10:00:00.000Z",
  };
}

describe("Bewerbungsfilter", () => {
  const applications = [
    application("1", "new", "Neu"),
    application("2", "reviewing", "Prüfung"),
    application("3", "contacted", "Kontakt"),
    application("4", "rejected", "Absage"),
    application("5", "hired", "Einstellung", "vertrieb"),
  ];

  it("fasst ausschließlich reviewing und contacted als in Bearbeitung zusammen", () => {
    expect(matchesApplicationStatus("reviewing", "active")).toBe(true);
    expect(matchesApplicationStatus("contacted", "active")).toBe(true);
    expect(matchesApplicationStatus("new", "active")).toBe(false);
    expect(filterApplications(applications, { status: "active", search: "" }).map(item => item.id)).toEqual(["2", "3"]);
    expect(getApplicationTotals(applications)).toEqual({ all: 5, new: 1, active: 2 });
  });

  it("kombiniert Status, Freitext und Funnel-Titel ohne Einzelstatus zu verwässern", () => {
    const funnelTitles = new Map([["vertrieb", "Vertrieb DACH"]]);
    expect(filterApplications(applications, { status: "hired", search: "DACH", funnelTitles }).map(item => item.id)).toEqual(["5"]);
    expect(filterApplications(applications, { status: "reviewing", search: "Kontakt" })).toEqual([]);
  });
});
