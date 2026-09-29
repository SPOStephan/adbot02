import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplicationRecord } from "@shared/funnel";
import { defaultFunnel } from "@shared/defaultFunnel";
import { sendApplicationNotification } from "./mail";
import { canViewMailLog, listMailLog, mailLogViewerEmails, resetMailLogMemoryForTests } from "./mailLog";

const application: ApplicationRecord = {
  id: "20000000-0000-4000-8000-000000000009",
  funnelId: defaultFunnel.id,
  funnelSlug: defaultFunnel.slug,
  status: "new",
  answers: {},
  contact: { name: "Erika Müster", email: "erika@example.org" },
  consentAt: "2026-09-29T08:00:00.000Z",
  utm: {},
  createdAt: "2026-09-29T08:00:00.000Z",
};

const config = { ...structuredClone(defaultFunnel), notificationEmail: "a@example.org, b@example.org" };

describe("Versandprotokoll", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("MAIL_FROM", "Funnel <funnel@example.org>");
    vi.stubEnv("MAIL_LOG_VIEWER_EMAILS", "");
    resetMailLogMemoryForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("ist standardmäßig nur für adbot@boncred.info sichtbar, nie für Funnel-Mitglieder", () => {
    expect(mailLogViewerEmails()).toEqual(["adbot@boncred.info"]);
    expect(canViewMailLog({ email: "Adbot@Boncred.info", loginMethod: "adbot-sso" })).toBe(true);
    expect(canViewMailLog({ email: "kunde@example.org", loginMethod: "adbot-sso" })).toBe(false);
    expect(canViewMailLog({ email: "adbot@boncred.info", loginMethod: "member" })).toBe(false);
  });

  it("protokolliert einen erfolgreichen Versand mit allen Empfängern und Resend-ID", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "resend-123" }), { status: 200 })));
    await expect(sendApplicationNotification(config, application)).resolves.toBe(true);
    const [entry] = await listMailLog();
    expect(entry).toMatchObject({
      status: "sent",
      recipients: ["a@example.org", "b@example.org"],
      providerMessageId: "resend-123",
      applicationId: application.id,
      funnelTitle: config.title,
    });
  });

  it("protokolliert einen fehlgeschlagenen Versand mit Fehlermeldung", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("domain not verified", { status: 403 })));
    await expect(sendApplicationNotification(config, application)).rejects.toThrow("403");
    const [entry] = await listMailLog();
    expect(entry.status).toBe("failed");
    expect(entry.error).toContain("domain not verified");
  });

  it("protokolliert übersprungene Mails, wenn kein Empfänger hinterlegt ist", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendApplicationNotification({ ...config, notificationEmail: "" }, application)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    const [entry] = await listMailLog();
    expect(entry).toMatchObject({ status: "skipped", error: "Keine Empfänger-E-Mail hinterlegt" });
  });
});
