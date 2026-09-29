import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { resetMemoryStoreForTests } from "./funnelStore";
import { appRouter } from "./routers";

const { storagePutMock } = vi.hoisted(() => ({ storagePutMock: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: storagePutMock }));
vi.mock("./bunny", () => ({
  isBunnyConfigured: () => false,
  uploadFunnelBytesToBunny: vi.fn(),
}));

const originalSupabaseUrl = process.env.SUPABASE_URL;
const originalSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const originalResendKey = process.env.RESEND_API_KEY;
const originalMailFrom = process.env.MAIL_FROM;

const publicContext: TrpcContext = {
  user: null,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
};

const adminContext: TrpcContext = {
  user: {
    id: 99,
    openId: "multi-funnel-admin",
    email: "admin@example.org",
    name: "Admin",
    loginMethod: "password",
    role: "admin",
    createdAt: new Date("2026-07-27T10:00:00.000Z"),
    updatedAt: new Date("2026-07-27T10:00:00.000Z"),
    lastSignedIn: new Date("2026-07-27T10:00:00.000Z"),
  },
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
};

describe("Funnel-Router", () => {
  beforeAll(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.RESEND_API_KEY;
    delete process.env.MAIL_FROM;
  });

  beforeEach(() => {
    resetMemoryStoreForTests();
    storagePutMock.mockReset();
    storagePutMock.mockResolvedValue({ key: "funnels/test/favicon.png", url: "https://storage.example.org/funnels/test/favicon.png" });
  });

  afterAll(() => {
    if (originalSupabaseUrl) process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalSupabaseKey) process.env.SUPABASE_SERVICE_ROLE_KEY = originalSupabaseKey;
    if (originalResendKey) process.env.RESEND_API_KEY = originalResendKey;
    if (originalMailFrom) process.env.MAIL_FROM = originalMailFrom;
    resetMemoryStoreForTests();
  });

  it("liefert nur öffentliche Konfiguration und nimmt eine vollständige Bewerbung an", async () => {
    const caller = appRouter.createCaller(publicContext);
    const config = await caller.funnel.publicConfig({ slug: "karriere" });
    expect(config.notificationEmail).toBe("");
    expect(config.allowedEmbedOrigins).toEqual([]);

    await expect(caller.funnel.submit({
      funnelSlug: "karriere",
      answers: {},
      contact: { name: "Erika Muster", email: "erika@example.org", phone: "+49 123" },
      consent: true,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const result = await caller.funnel.submit({
      funnelSlug: "karriere",
      answers: { arbeitsbereich: ["vertrieb"], berufserfahrung: ["3-plus"] },
      contact: { name: "Erika Muster", email: "erika@example.org", phone: "+49 123" },
      consent: true,
      sourceUrl: "https://example.org/f/karriere",
      utm: { utm_source: "integrationstest" },
    });

    expect(result.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.notificationSent).toBe(false);
    expect(result.leadValue).toBe(150);
  });

  it("bewahrt eine erstmals gesetzte Empfänger-E-Mail vor einem nachlaufenden Editor-Save", async () => {
    const admin = appRouter.createCaller(adminContext);
    const { config } = await admin.funnel.adminConfig();
    const staleEditorConfig = structuredClone(config);

    await admin.funnel.saveConfig({ ...config, notificationEmail: "bewerbung@example.org", notificationEmailWrite: "set" });
    await admin.funnel.saveConfig({ ...staleEditorConfig, title: "Editor-Änderung", notificationEmailWrite: "preserve" });

    const afterEditorSave = (await admin.funnel.adminConfig({ id: config.id })).config;
    expect(afterEditorSave.notificationEmail).toBe("bewerbung@example.org");

    await admin.funnel.saveConfig({ ...afterEditorSave, notificationEmail: "jobs@example.org", notificationEmailWrite: "set" });

    expect((await admin.funnel.adminConfig({ id: config.id })).config.notificationEmail).toBe("jobs@example.org");
  });

  it("liefert den Shared-Funnel nicht auf unbekannten Custom-Hosts", async () => {
    const caller = appRouter.createCaller(publicContext);
    await expect(
      caller.funnel.publicConfig({ slug: "karriere", hostname: "fremd.example" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller.funnel.submit({
        funnelSlug: "karriere",
        answers: { arbeitsbereich: ["vertrieb"], berufserfahrung: ["3-plus"] },
        contact: { name: "Erika Muster", email: "erika@example.org", phone: "+49 123" },
        consent: true,
        hostname: "fremd.example",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller.funnel.publicCatalogByHost({ hostname: "fremd.example" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const catalog = await caller.funnel.publicCatalogByHost({ hostname: "funnel.adbot.one" });
    expect(catalog.kind).toBe("platform");
  });

  it("speichert eine manuelle Gut-Bewertung auch ohne CAPI-Token", async () => {
    const admin = appRouter.createCaller(adminContext);
    const publicCaller = appRouter.createCaller(publicContext);
    const submitted = await publicCaller.funnel.submit({
      funnelSlug: "karriere",
      answers: { arbeitsbereich: ["vertrieb"], berufserfahrung: ["3-plus"] },
      contact: { name: "Erika Muster", email: "erika@example.org", phone: "+49 123" },
      consent: true,
    });
    const rated = await admin.funnel.rateLeadQuality({ id: submitted.id, quality: "good" });
    expect(rated.leadQuality).toBe("good");
    expect(rated.leadValue).toBe(150);
    expect(rated.metaQuality).toBe("skipped");
    expect(rated.metaQualityReason).toBe("tracking_disabled");
    const again = await admin.funnel.rateLeadQuality({ id: submitted.id, quality: "good" });
    expect(again.leadQualityEventId).toBe(rated.leadQualityEventId);
    expect(again.metaQualityReason).toBe("tracking_disabled");
  });

  it("liefert im Bewerbungs-Dashboard die sichtbare Frage statt technischer Question-IDs", async () => {
    const admin = appRouter.createCaller(adminContext);
    const publicCaller = appRouter.createCaller(publicContext);
    const { config } = await admin.funnel.adminConfig();
    const technicalQuestionKey = "question-32395331-216c-4e1c-99cc-73256a3bdcb3";
    const pages = config.pages.map(page => page.type === "choice-grid"
      ? { ...page, name: "Sachkunde", questionKey: technicalQuestionKey }
      : page);
    await admin.funnel.saveConfig({ ...config, pages });

    const result = await publicCaller.funnel.submit({
      funnelSlug: config.slug,
      answers: { [technicalQuestionKey]: ["vertrieb"], berufserfahrung: ["3-plus"] },
      contact: { name: "Erika Muster", email: "erika@example.org", phone: "+49 123" },
      consent: true,
    });
    const detail = await admin.funnel.application({ id: result.id });

    expect(detail.displayAnswers).toEqual([
      { label: "Welcher Bereich passt am besten zu dir?", values: ["Vertrieb"] },
      { label: "Wie viel Berufserfahrung bringst du mit?", values: ["Mehr als 3 Jahre"] },
    ]);
    expect(JSON.stringify(detail.displayAnswers)).not.toContain(technicalQuestionKey);
    expect(JSON.stringify(detail.displayAnswers)).not.toContain("Sachkunde");
  });

  it("verschiebt Einträge in den Papierkorb und stellt sie wieder her", async () => {
    const admin = appRouter.createCaller(adminContext);
    const publicCaller = appRouter.createCaller(publicContext);
    const { config } = await admin.funnel.adminConfig();
    const result = await publicCaller.funnel.submit({
      funnelSlug: config.slug,
      answers: { arbeitsbereich: ["vertrieb"], berufserfahrung: ["3-plus"] },
      contact: { name: "Test Eintrag", email: "test@example.org", phone: "+49 123" },
      consent: true,
    });

    const deleted = await admin.funnel.deleteApplication({ id: result.id });
    expect(new Date(deleted.purgeAt).getTime() - new Date(deleted.deletedAt).getTime()).toBe(14 * 24 * 60 * 60 * 1000);
    expect((await admin.funnel.applications()).map(item => item.id)).not.toContain(result.id);
    expect((await admin.funnel.trashedApplications()).map(item => item.id)).toContain(result.id);
    expect((await admin.funnel.application({ id: result.id })).purgeAt).toBe(deleted.purgeAt);

    await admin.funnel.restoreApplication({ id: result.id });
    expect((await admin.funnel.applications()).map(item => item.id)).toContain(result.id);
    expect((await admin.funnel.trashedApplications()).map(item => item.id)).not.toContain(result.id);
  });

  it("schützt die Funnel-Bibliothek vor öffentlichen Aufrufen", async () => {
    const caller = appRouter.createCaller(publicContext);
    await expect(caller.funnel.funnels()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("verwaltet Meta-Zugangsdaten nur geschützt und liefert sie niemals öffentlich aus", async () => {
    const admin = appRouter.createCaller(adminContext);
    const publicCaller = appRouter.createCaller(publicContext);
    const { config } = await admin.funnel.adminConfig();
    await admin.funnel.saveConfig({ ...config, metaTracking: { ...config.metaTracking, enabled: true, pixelId: "123456789012345" } });
    await admin.funnel.saveMetaServerSettings({ funnelId: config.id, accessToken: "meta-super-secret-token-value", clearAccessToken: false, testEventCode: "TEST-123" });

    expect((await admin.funnel.adminConfig({ id: config.id })).metaServerSettings).toEqual({ hasAccessToken: true, testEventCode: "TEST-123" });
    const publicConfig = await publicCaller.funnel.publicConfig({ slug: config.slug });
    expect(publicConfig.metaTracking.pixelId).toBe("123456789012345");
    expect(JSON.stringify(publicConfig)).not.toContain("meta-super-secret-token-value");
    expect(JSON.stringify(publicConfig)).not.toContain("__serverPrivate");

    await admin.funnel.saveMetaServerSettings({ funnelId: config.id, clearAccessToken: true, testEventCode: "" });
    expect((await admin.funnel.adminConfig({ id: config.id })).metaServerSettings).toEqual({ hasAccessToken: false, testEventCode: "" });
  });

  it("schützt und validiert den Favicon-Upload vor dem Speichern", async () => {
    const publicCaller = appRouter.createCaller(publicContext);
    const admin = appRouter.createCaller(adminContext);
    const invalidPayload = {
      funnelId: "10000000-0000-4000-8000-000000000001",
      fileName: "favicon.png",
      mimeType: "image/png" as const,
      size: 4,
      dataBase64: Buffer.from("kein-png").toString("base64"),
    };

    await expect(publicCaller.funnel.uploadFavicon(invalidPayload)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(admin.funnel.uploadFavicon(invalidPayload)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Die Favicon-Datei ist beschädigt oder hat ein nicht unterstütztes Format.",
    });
  });

  it("speichert ein gültiges Favicon und liefert seine persistierte URL öffentlich aus", async () => {
    const admin = appRouter.createCaller(adminContext);
    const publicCaller = appRouter.createCaller(publicContext);
    const { config } = await admin.funnel.adminConfig();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const stored = await admin.funnel.uploadFavicon({
      funnelId: config.id,
      fileName: "favicon.png",
      mimeType: "image/png",
      size: png.byteLength,
      dataBase64: png.toString("base64"),
    });
    expect(storagePutMock).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^funnels/${config.id}/branding/[0-9a-f-]+-favicon\\.png$`, "i")),
      png,
      "image/png",
    );

    await admin.funnel.saveConfig({ ...config, brand: { ...config.brand, faviconUrl: stored.url } });
    expect((await publicCaller.funnel.publicConfig({ slug: config.slug })).brand.faviconUrl).toBe(stored.url);
  });

  it("speichert ein gültiges Logo und lehnt beschädigte Dateien ab", async () => {
    const publicCaller = appRouter.createCaller(publicContext);
    const admin = appRouter.createCaller(adminContext);
    const { config } = await admin.funnel.adminConfig();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const invalidPayload = {
      funnelId: config.id,
      fileName: "logo.png",
      mimeType: "image/png" as const,
      size: 4,
      dataBase64: Buffer.from("kein-png").toString("base64"),
    };

    await expect(publicCaller.funnel.uploadLogo(invalidPayload)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(admin.funnel.uploadLogo(invalidPayload)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Die Logo-Datei ist beschädigt oder hat ein nicht unterstütztes Format.",
    });

    const stored = await admin.funnel.uploadLogo({
      funnelId: config.id,
      fileName: "logo.png",
      mimeType: "image/png",
      size: png.byteLength,
      dataBase64: png.toString("base64"),
    });
    expect(storagePutMock).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^funnels/${config.id}/branding/[0-9a-f-]+-logo\\.png$`, "i")),
      png,
      "image/png",
    );
    await admin.funnel.saveConfig({ ...config, brand: { ...config.brand, logoUrl: stored.url } });
    expect((await publicCaller.funnel.publicConfig({ slug: config.slug })).brand.logoUrl).toBe(stored.url);

    const webp = Buffer.alloc(12);
    webp[0] = 0x52; webp[1] = 0x49; webp[2] = 0x46; webp[3] = 0x46;
    webp[8] = 0x57; webp[9] = 0x45; webp[10] = 0x42; webp[11] = 0x50;
    const portrait = await admin.funnel.uploadHeroImage({
      funnelId: config.id,
      fileName: "portrait.png",
      mimeType: "image/webp",
      size: webp.byteLength,
      dataBase64: webp.toString("base64"),
    });
    expect(portrait.url.length).toBeGreaterThan(0);
    expect(storagePutMock).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^funnels/${config.id}/portraits/[0-9a-f-]+-portrait\\.webp$`, "i")),
      webp,
      "image/webp",
    );
  });

  it("nimmt zugeschnittene Hintergrundbilder in die Kundenbibliothek auf", async () => {
    const admin = appRouter.createCaller(adminContext);
    const config = await admin.funnel.adminConfig({ id: "10000000-0000-4000-8000-000000000001" }).then(result => result.config);
    const tiny = Buffer.from("d2VicA==", "base64");
    const asset = await admin.funnel.uploadHeroBackground({
      funnelId: config.id,
      fileName: "hero.jpg",
      desktop: { dataBase64: tiny.toString("base64"), mimeType: "image/webp", size: tiny.byteLength },
      mobile: { dataBase64: tiny.toString("base64"), mimeType: "image/webp", size: tiny.byteLength },
    });
    expect(asset.desktopUrl.length).toBeGreaterThan(0);
    expect(asset.mobileUrl.length).toBeGreaterThan(0);
    const library = await admin.funnel.mediaLibrary({ funnelId: config.id });
    expect(library.some(item => item.id === asset.id)).toBe(true);
  });

  it("erstellt, dupliziert und filtert mehrere Funnel ohne Bewerbungen zu kopieren", async () => {
    const admin = appRouter.createCaller(adminContext);
    const publicCaller = appRouter.createCaller(publicContext);
    const created = await admin.funnel.create({ title: "Vertrieb Nord", slug: "vertrieb-nord", purpose: "lead_qualification" });
    const collisionSafe = await admin.funnel.create({ title: "Vertrieb Nord Zwei", slug: "vertrieb-nord", purpose: "appointment" });
    expect(created.status).toBe("draft");
    expect(created.purpose).toBe("lead_qualification");
    expect(created.pages.some(page => page.type === "contact" && page.buttonLabel === "Anfrage absenden")).toBe(true);
    expect(collisionSafe.slug).toBe("vertrieb-nord-2");

    await admin.funnel.setFunnelStatus({ id: created.id, status: "published" });
    const answers = Object.fromEntries(created.pages
      .filter(page => page.type === "choice-grid" || page.type === "choice-list")
      .map(page => [page.questionKey, [page.options[0]!.value]]));
    const submission = await publicCaller.funnel.submit({
      funnelSlug: created.slug,
      answers,
      contact: { name: "Erika Muster", email: "erika@example.org", phone: "+49 123" },
      consent: true,
    });
    expect(submission.id).toMatch(/^[0-9a-f-]{36}$/i);

    const copy = await admin.funnel.duplicate({ sourceId: created.id, title: "Vertrieb Nord Kopie", slug: "vertrieb-nord-kopie" });
    expect(copy.id).not.toBe(created.id);
    expect(copy.status).toBe("draft");
    expect(copy.purpose).toBe("lead_qualification");
    expect(copy.pages.map(page => page.id)).not.toEqual(created.pages.map(page => page.id));
    expect(await admin.funnel.applications({ funnelId: copy.id })).toEqual([]);
    expect(await admin.funnel.applications({ funnelId: created.id })).toHaveLength(1);
    expect((await admin.funnel.funnels()).map(funnel => funnel.slug)).toEqual(expect.arrayContaining(["karriere", "vertrieb-nord", "vertrieb-nord-2", "vertrieb-nord-kopie"]));
  });

  it("blendet gespeicherte Ideenseiten öffentlich aus und verlangt dort keine Antwort", async () => {
    const admin = appRouter.createCaller(adminContext);
    const publicCaller = appRouter.createCaller(publicContext);
    const created = await admin.funnel.create({ title: "Ideen-Funnel", slug: "ideen-seiten", purpose: "survey_other" });
    const hiddenRole = created.pages.find(page => page.type === "choice-grid");
    if (!hiddenRole || hiddenRole.type !== "choice-grid") throw new Error("Auswahlseite fehlt");
    const pages = created.pages.map(page => page.id === hiddenRole.id ? { ...page, hidden: true } : page);
    await admin.funnel.saveConfig({ ...created, pages, status: "published", isPublished: true });

    const stored = await admin.funnel.adminConfig({ id: created.id });
    expect(stored.config.pages.find(page => page.id === hiddenRole.id)?.hidden).toBe(true);
    expect(stored.config.pages.map(page => page.id)).toEqual(created.pages.map(page => page.id));

    const publicConfig = await publicCaller.funnel.publicConfig({ slug: created.slug });
    expect(publicConfig.pages.some(page => page.id === hiddenRole.id)).toBe(false);
    expect(publicConfig.pages.map(page => page.type)).toEqual(["start", "choice-list", "contact"]);

    const visibleChoice = publicConfig.pages.find(page => page.type === "choice-list");
    if (!visibleChoice || visibleChoice.type !== "choice-list") throw new Error("Sichtbare Auswahlseite fehlt");
    const result = await publicCaller.funnel.submit({
      funnelSlug: created.slug,
      answers: { [visibleChoice.questionKey]: [visibleChoice.options[2]!.value] },
      contact: { name: "Erika Muster", email: "erika@example.org", phone: "+49 123" },
      consent: true,
    });
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.leadValue).toBe(visibleChoice.options[2]!.leadValue);
  });

  it("liefert nur veröffentlichte Funnel öffentlich aus", async () => {
    const admin = appRouter.createCaller(adminContext);
    const publicCaller = appRouter.createCaller(publicContext);
    const created = await admin.funnel.create({ title: "Technik", slug: "technik", purpose: "lead_qualification" });
    await expect(publicCaller.funnel.publicConfig({ slug: created.slug })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await admin.funnel.setFunnelStatus({ id: created.id, status: "published" });
    expect((await publicCaller.funnel.publicConfig({ slug: created.slug })).id).toBe(created.id);
    await admin.funnel.setFunnelStatus({ id: created.id, status: "paused" });
    await expect(publicCaller.funnel.publicConfig({ slug: created.slug })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await admin.funnel.setFunnelStatus({ id: created.id, status: "archived" });
    await expect(publicCaller.funnel.submit({
      funnelSlug: created.slug,
      answers: { arbeitsbereich: ["vertrieb"], berufserfahrung: ["3-plus"] },
      contact: { name: "Erika Muster", email: "erika@example.org", phone: "+49 123" },
      consent: true,
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
