import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { resetMemoryStoreForTests } from "./funnelStore";
import { appRouter } from "./routers";

const { storagePutMock } = vi.hoisted(() => ({ storagePutMock: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: storagePutMock }));

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
  });

  it("liefert im Bewerbungs-Dashboard interne Seitennamen statt technischer Question-IDs", async () => {
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
      { label: "Sachkunde", values: ["vertrieb"] },
      { label: "Berufserfahrung", values: ["3-plus"] },
    ]);
    expect(JSON.stringify(detail.displayAnswers)).not.toContain(technicalQuestionKey);
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
      expect.stringMatching(new RegExp(`^funnels/${config.id}/branding/favicon-[0-9a-f-]+\\.png$`, "i")),
      png,
      "image/png",
    );

    await admin.funnel.saveConfig({ ...config, brand: { ...config.brand, faviconUrl: stored.url } });
    expect((await publicCaller.funnel.publicConfig({ slug: config.slug })).brand.faviconUrl).toBe(stored.url);
  });

  it("erstellt, dupliziert und filtert mehrere Funnel ohne Bewerbungen zu kopieren", async () => {
    const admin = appRouter.createCaller(adminContext);
    const publicCaller = appRouter.createCaller(publicContext);
    const created = await admin.funnel.create({ title: "Vertrieb Nord", slug: "vertrieb-nord" });
    const collisionSafe = await admin.funnel.create({ title: "Vertrieb Nord Zwei", slug: "vertrieb-nord" });
    expect(created.status).toBe("draft");
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
    expect(copy.pages.map(page => page.id)).not.toEqual(created.pages.map(page => page.id));
    expect(await admin.funnel.applications({ funnelId: copy.id })).toEqual([]);
    expect(await admin.funnel.applications({ funnelId: created.id })).toHaveLength(1);
    expect((await admin.funnel.funnels()).map(funnel => funnel.slug)).toEqual(expect.arrayContaining(["karriere", "vertrieb-nord", "vertrieb-nord-2", "vertrieb-nord-kopie"]));
  });

  it("liefert nur veröffentlichte Funnel öffentlich aus", async () => {
    const admin = appRouter.createCaller(adminContext);
    const publicCaller = appRouter.createCaller(publicContext);
    const created = await admin.funnel.create({ title: "Technik", slug: "technik" });
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
