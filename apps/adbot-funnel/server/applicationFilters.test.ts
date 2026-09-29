import { describe, expect, it } from "vitest";
import { DEFAULT_APPLICATION_SORT, filterApplications, getApplicationTotals, matchesApplicationStatus, nextApplicationSort, sortApplications } from "@shared/applicationFilters";
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

describe("Bewerbungssortierung", () => {
  function at(id: string, createdAt: string, overrides: Partial<ApplicationRecord> = {}): ApplicationRecord {
    return { ...application(id, "new", `Person ${id}`), createdAt, ...overrides };
  }
  const ids = (list: ApplicationRecord[]) => list.map(entry => entry.id);

  it("zeigt standardmäßig die neueste Bewerbung oben, unabhängig vom Funnel", () => {
    const list = [
      at("a", "2026-07-01T10:00:00.000Z", { funnelSlug: "alpha" }),
      at("b", "2026-07-03T10:00:00.000Z", { funnelSlug: "zeta" }),
      at("c", "2026-07-02T10:00:00.000Z", { funnelSlug: "alpha" }),
    ];
    expect(ids(sortApplications(list))).toEqual(["b", "c", "a"]);
    expect(DEFAULT_APPLICATION_SORT).toEqual({ key: "createdAt", direction: "desc" });
  });

  it("sortiert nach Spalte auf- und absteigend, leere Werte immer zuletzt", () => {
    const list = [
      at("1", "2026-07-01T10:00:00.000Z", { contact: { name: "Özil" } }),
      at("2", "2026-07-02T10:00:00.000Z", { contact: { name: "" } }),
      at("3", "2026-07-03T10:00:00.000Z", { contact: { name: "anna" } }),
      at("4", "2026-07-04T10:00:00.000Z", { contact: { name: "Bernd" } }),
    ];
    expect(ids(sortApplications(list, { key: "contact", direction: "asc" }))).toEqual(["3", "4", "1", "2"]);
    expect(ids(sortApplications(list, { key: "contact", direction: "desc" }))).toEqual(["1", "4", "3", "2"]);
  });

  it("nutzt Funnel-Titel und fällt bei Gleichstand auf neueste zuerst zurück", () => {
    const titles = new Map([["x", "Zahnarzt"], ["y", "Azubi"]]);
    const list = [
      at("1", "2026-07-01T10:00:00.000Z", { funnelSlug: "y" }),
      at("2", "2026-07-02T10:00:00.000Z", { funnelSlug: "x" }),
      at("3", "2026-07-03T10:00:00.000Z", { funnelSlug: "y" }),
    ];
    expect(ids(sortApplications(list, { key: "funnel", direction: "asc" }, titles))).toEqual(["3", "1", "2"]);
  });

  it("sortiert Status im Bearbeitungsablauf und Bewertung Gut vor Schlecht vor offen", () => {
    const list = [
      at("1", "2026-07-01T10:00:00.000Z", { status: "hired", leadQuality: "good" }),
      at("2", "2026-07-02T10:00:00.000Z", { status: "new" }),
      at("3", "2026-07-03T10:00:00.000Z", { status: "reviewing", leadQuality: "bad" }),
    ];
    expect(ids(sortApplications(list, { key: "status", direction: "asc" }))).toEqual(["2", "3", "1"]);
    expect(ids(sortApplications(list, { key: "rating", direction: "desc" }))).toEqual(["1", "3", "2"]);
  });

  it("kehrt beim erneuten Klick die Richtung um und startet neue Spalten sinnvoll", () => {
    expect(nextApplicationSort(DEFAULT_APPLICATION_SORT, "createdAt")).toEqual({ key: "createdAt", direction: "asc" });
    expect(nextApplicationSort(DEFAULT_APPLICATION_SORT, "contact")).toEqual({ key: "contact", direction: "asc" });
    expect(nextApplicationSort({ key: "contact", direction: "asc" }, "createdAt")).toEqual({ key: "createdAt", direction: "desc" });
  });
});
