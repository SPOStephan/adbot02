import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { defaultFunnel } from "@shared/defaultFunnel";
import {
  createApplication,
  createFunnel,
  createFunnelFromTemplate,
  getApplication,
  getFunnel,
  getFunnelOwner,
  getUniqueFunnelSlug,
  listApplications,
  listFunnels,
  normalizeFunnelConfig,
  resetMemoryStoreForTests,
  saveFunnel,
  setFunnelOwner,
  slugifyFunnel,
  updateApplicationStatus,
} from "./funnelStore";

const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe("Mehr-Funnel-Speicher", () => {
  beforeAll(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  beforeEach(() => resetMemoryStoreForTests());

  afterAll(() => {
    if (originalUrl) process.env.SUPABASE_URL = originalUrl;
    if (originalKey) process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    resetMemoryStoreForTests();
  });

  it("speichert eine vollständige Bewerbung atomar und aktualisiert ihren Status", async () => {
    const funnel = { ...structuredClone(defaultFunnel), id: "30000000-0000-4000-8000-000000000001", slug: "test-speicher" };
    await saveFunnel(funnel);
    const created = await createApplication({
      funnelSlug: funnel.slug,
      answers: { arbeitsbereich: ["vertrieb"] },
      contact: { name: "Erika Muster", email: "erika@example.org", phone: "+49 123" },
      consent: true,
      sourceUrl: "https://example.org/f/test-speicher",
      utm: { utm_source: "test" },
      resume: { key: "applications/test/cv.pdf", url: "/api/storage/applications/test/cv.pdf", fileName: "cv.pdf", mimeType: "application/pdf", size: 1200 },
    });

    expect(created.status).toBe("new");
    expect(created.resume?.fileName).toBe("cv.pdf");
    expect((await getApplication(created.id))?.contact.email).toBe("erika@example.org");
    expect((await listApplications()).some(item => item.id === created.id)).toBe(true);
    expect((await updateApplicationStatus(created.id, "contacted"))?.status).toBe("contacted");
  });

  it("erzeugt normalisierte und kollisionsfreie Slugs", async () => {
    expect(slugifyFunnel("  Vertrieb Süd & Österreich  ")).toBe("vertrieb-sud-osterreich");
    const first = createFunnelFromTemplate(defaultFunnel, "Vertrieb DACH", "vertrieb-dach");
    await createFunnel(first);
    expect(await getUniqueFunnelSlug("Vertrieb DACH")).toBe("vertrieb-dach-2");
    await expect(saveFunnel({ ...first, id: randomUUID(), slug: "karriere" })).rejects.toThrow(/URL-Slug|existiert/);
  });

  it("kopiert Konfigurationen tief mit neuen technischen IDs und ohne Veröffentlichung", () => {
    const copy = createFunnelFromTemplate(defaultFunnel, "Karriere Kopie", "karriere-kopie");
    expect(copy.id).not.toBe(defaultFunnel.id);
    expect(copy.status).toBe("draft");
    expect(copy.isPublished).toBe(false);
    expect(copy.pages.map(page => page.id)).not.toEqual(defaultFunnel.pages.map(page => page.id));
    const originalQuestions = defaultFunnel.pages.filter(page => page.type === "choice-grid" || page.type === "choice-list");
    const copiedQuestions = copy.pages.filter(page => page.type === "choice-grid" || page.type === "choice-list");
    expect(copiedQuestions.map(page => page.questionKey)).not.toEqual(originalQuestions.map(page => page.questionKey));
    expect(copiedQuestions.flatMap(page => page.options.map(option => option.id))).not.toEqual(originalQuestions.flatMap(page => page.options.map(option => option.id)));
    expect(copy.brand).toEqual(defaultFunnel.brand);
    expect(copiedQuestions.map(page => page.eyebrow)).toEqual(originalQuestions.map(page => page.eyebrow));
  });

  it("normalisiert Lebenszyklusstatus und Bibliothekszusammenfassung konsistent", async () => {
    const created = await createFunnel(createFunnelFromTemplate(defaultFunnel, "Technik", "technik"));
    await saveFunnel({ ...created, status: "paused", isPublished: true });
    expect(await getFunnel("technik")).toMatchObject({ status: "paused", isPublished: false });
    expect((await listFunnels()).find(funnel => funnel.id === created.id)).toMatchObject({ status: "paused", applicationCount: 0, newApplicationCount: 0 });
  });

  it("normalisiert einen veröffentlichten Bestandsfunnel ohne Status verlustfrei", async () => {
    const legacyConfig = structuredClone(defaultFunnel);
    Reflect.deleteProperty(legacyConfig, "status");
    Reflect.deleteProperty(legacyConfig.brand, "faviconUrl");
    Reflect.deleteProperty(legacyConfig.brand, "choiceBackgroundColor");
    Reflect.deleteProperty(legacyConfig.brand, "choiceTextColor");
    Reflect.deleteProperty(legacyConfig.brand, "choiceSelectedBackgroundColor");
    Reflect.deleteProperty(legacyConfig.brand, "choiceSelectedTextColor");
    Reflect.deleteProperty(legacyConfig.brand, "choiceSelectedBorderColor");
    legacyConfig.pages.filter(page => page.type !== "start").forEach(page => Reflect.deleteProperty(page, "eyebrow"));
    const legacyOption = legacyConfig.pages.find(page => page.type === "choice-grid")?.options[0] as { icon: string } | undefined;
    if (legacyOption) legacyOption.icon = "historisches-sondericon";

    const normalized = normalizeFunnelConfig(legacyConfig, true);
    expect(normalized).toMatchObject({
      id: defaultFunnel.id,
      slug: defaultFunnel.slug,
      status: "published",
      isPublished: true,
    });
    expect(normalized.brand).toMatchObject({
      faviconUrl: "",
      choiceBackgroundColor: "#ffffff",
      choiceTextColor: "#10253f",
      choiceSelectedBackgroundColor: "#eef7ff",
      choiceSelectedTextColor: "#10253f",
      choiceSelectedBorderColor: "#0165c3",
    });
    expect(normalized.pages.find(page => page.type === "choice-grid")?.eyebrow).toBe("Kurze Frage");
    expect(normalized.pages.find(page => page.type === "choice-list")?.eyebrow).toBe("Kurze Frage");
    expect(normalized.pages.find(page => page.type === "contact")?.eyebrow).toBe("Fast geschafft");
    expect(normalized.pages.find(page => page.type === "choice-grid")?.options[0]?.icon).toBe("sparkles");
    expect(normalized.pages[0]?.title).toBe(defaultFunnel.pages[0]?.title);

    await saveFunnel(normalized);
    const application = await createApplication({
      funnelSlug: normalized.slug,
      answers: { arbeitsbereich: ["vertrieb"] },
      contact: { name: "Bestandsbewerbung", email: "bestand@example.org", phone: "+49 123" },
      consent: true,
    });

    expect(application).toMatchObject({ funnelId: defaultFunnel.id, funnelSlug: defaultFunnel.slug });
    expect(await listApplications(defaultFunnel.id)).toEqual([expect.objectContaining({ id: application.id })]);
    expect(normalized.metaTracking.conversionTrigger).toBe("submit");
  });

  it("bindet Funnel an Adbot-Owner und filtert die Bibliothek", async () => {
    const ownerId = "11111111-1111-4111-8111-111111111111";
    const otherOwnerId = "22222222-2222-4222-8222-222222222222";
    const owned = await createFunnel(
      createFunnelFromTemplate(defaultFunnel, "Owner Funnel", "owner-funnel"),
      { userId: ownerId, email: "kunde@example.org" },
    );
    await createFunnel(
      createFunnelFromTemplate(defaultFunnel, "Fremd Funnel", "fremd-funnel"),
      { userId: otherOwnerId, email: "fremd@example.org" },
    );

    expect(await getFunnelOwner(owned.id)).toEqual({ userId: ownerId, email: "kunde@example.org" });
    expect(await listFunnels({ ownerUserId: ownerId })).toEqual([
      expect.objectContaining({ id: owned.id, ownerUserId: ownerId, ownerEmail: "kunde@example.org" }),
    ]);

    const reassigned = await setFunnelOwner(owned.id, { userId: otherOwnerId, email: "neu@example.org" });
    expect(reassigned).toMatchObject({ ownerUserId: otherOwnerId, ownerEmail: "neu@example.org" });
    expect(await listFunnels({ ownerUserId: ownerId })).toEqual([]);
  });
});
