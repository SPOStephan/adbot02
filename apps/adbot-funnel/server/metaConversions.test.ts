import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { defaultFunnel } from "@shared/defaultFunnel";
import type { ApplicationRecord, ApplicationSubmission } from "@shared/funnel";
import {
  resetMemoryStoreForTests,
  saveMetaServerSettings,
} from "./funnelStore";
import {
  buildMetaConversionEvent,
  sendMetaApplicationConversion,
} from "./metaConversions";

const originalSupabaseUrl = process.env.SUPABASE_URL;
const originalSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const config = {
  ...defaultFunnel,
  metaTracking: {
    ...defaultFunnel.metaTracking,
    enabled: true,
    pixelId: "123456789012345",
    eventName: "Lead",
  },
};
const submission: ApplicationSubmission = {
  funnelSlug: config.slug,
  answers: {},
  contact: {
    name: "Erika Muster",
    email: "Erika@Example.org",
    phone: "+49 123 456",
  },
  consent: true,
  metaEventId: "10000000-0000-4000-8000-000000000099",
  metaFbp: "fb.1.123.456",
  metaFbc: "fb.1.123.click",
  sourceUrl: "https://example.org/f/karriere",
};
const application: ApplicationRecord = {
  id: "20000000-0000-4000-8000-000000000099",
  funnelId: config.id,
  funnelSlug: config.slug,
  status: "new",
  answers: {},
  contact: submission.contact,
  consentAt: "2026-07-28T12:00:00.000Z",
  metaEventId: submission.metaEventId,
  sourceUrl: submission.sourceUrl,
  utm: {},
  createdAt: "2026-07-28T12:00:00.000Z",
};

describe("Meta Conversions API", () => {
  beforeAll(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });
  beforeEach(() => resetMemoryStoreForTests());
  afterAll(() => {
    if (originalSupabaseUrl) process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalSupabaseKey)
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalSupabaseKey;
    resetMemoryStoreForTests();
  });

  it("baut ein deduplizierbares Ereignis ohne Klartext-Kontaktdaten", () => {
    const event = buildMetaConversionEvent(config, application, submission, {
      clientIp: "203.0.113.42",
      userAgent: "Vitest",
    });
    expect(event.event_id).toBe(submission.metaEventId);
    expect(event.event_name).toBe("Lead");
    expect(event.user_data.fbp).toBe(submission.metaFbp);
    expect(event.user_data.fbc).toBe(submission.metaFbc);
    expect(event.user_data.em?.[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(event)).not.toContain("Erika@Example.org");
    expect(JSON.stringify(event)).not.toContain("+49 123 456");
  });

  it("sendet mit Token und Testcode an Graph API v25.0", async () => {
    await saveMetaServerSettings(config.id, {
      accessToken: "EAAB-server-token-long-value",
      clearAccessToken: false,
      testEventCode: "TEST-123",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ events_received: 1, fbtrace_id: "trace-success" }),
          { status: 200 }
        )
      );
    const consoleInfo = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    try {
      await expect(
        sendMetaApplicationConversion(
          config,
          application,
          submission,
          {},
          fetchMock
        )
      ).resolves.toEqual({ status: "sent", eventsReceived: 1 });
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, request] = fetchMock.mock.calls[0]!;
      expect(url).toBe(
        "https://graph.facebook.com/v25.0/123456789012345/events"
      );
      const body = JSON.parse(String(request.body));
      expect(body.access_token).toBe("EAAB-server-token-long-value");
      expect(body.test_event_code).toBe("TEST-123");
      expect(body.data[0].event_id).toBe(submission.metaEventId);
      expect(consoleInfo).toHaveBeenCalledWith(
        "[Meta CAPI] Ereignis bestätigt",
        {
          eventId: submission.metaEventId,
          pixelId: config.metaTracking.pixelId,
          httpStatus: 200,
          eventsReceived: 1,
          traceId: "trace-success",
        }
      );
    } finally {
      consoleInfo.mockRestore();
    }
  });

  it("überspringt deaktiviertes Tracking oder fehlende Event-ID und macht Meta-Fehler nicht zum Bewerbungsfehler", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error("Meta nicht erreichbar"));
    await expect(
      sendMetaApplicationConversion(
        { ...config, metaTracking: { ...config.metaTracking, enabled: false } },
        application,
        submission,
        {},
        fetchMock
      )
    ).resolves.toEqual({ status: "skipped", reason: "tracking_disabled" });
    await expect(
      sendMetaApplicationConversion(
        config,
        application,
        { ...submission, metaEventId: undefined },
        {},
        fetchMock
      )
    ).resolves.toEqual({ status: "skipped", reason: "event_id_missing" });
    expect(fetchMock).not.toHaveBeenCalled();
    await saveMetaServerSettings(config.id, {
      accessToken: "EAAB-server-token-long-value",
      clearAccessToken: false,
      testEventCode: "",
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await expect(
        sendMetaApplicationConversion(
          config,
          application,
          submission,
          {},
          fetchMock
        )
      ).resolves.toEqual({
        status: "failed",
        reason: "Meta CAPI konnte technisch nicht erreicht werden",
      });
      expect(consoleError).toHaveBeenCalledWith(
        "[Meta CAPI] Übertragung technisch fehlgeschlagen",
        {
          eventId: submission.metaEventId,
          pixelId: config.metaTracking.pixelId,
          errorType: "Error",
        }
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("wertet HTTP 2xx ohne von Meta bestätigtes Ereignis als fehlgeschlagen", async () => {
    await saveMetaServerSettings(config.id, {
      accessToken: "EAAB-server-token-long-value",
      clearAccessToken: false,
      testEventCode: "TEST-123",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            events_received: 0,
            messages: ["nicht angenommen"],
            fbtrace_id: "trace-zero",
          }),
          { status: 200 }
        )
      );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await expect(
        sendMetaApplicationConversion(
          config,
          application,
          submission,
          {},
          fetchMock
        )
      ).resolves.toEqual({
        status: "failed",
        reason: "Meta CAPI hat kein empfangenes Ereignis bestätigt",
        eventsReceived: 0,
      });
      expect(consoleError).toHaveBeenCalledWith(
        "[Meta CAPI] Ereignis nicht bestätigt",
        {
          eventId: submission.metaEventId,
          pixelId: config.metaTracking.pixelId,
          httpStatus: 200,
          eventsReceived: 0,
          traceId: "trace-zero",
        }
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("protokolliert Meta-Fehler strukturiert ohne rohe Fehlermeldung", async () => {
    await saveMetaServerSettings(config.id, {
      accessToken: "EAAB-server-token-long-value",
      clearAccessToken: false,
      testEventCode: "TEST-123",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "Fehlerdetails mit potenziell sensiblen Angaben",
            type: "OAuthException",
            code: 190,
            error_subcode: 463,
            fbtrace_id: "trace-error",
          },
        }),
        { status: 400 }
      )
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await expect(
        sendMetaApplicationConversion(
          config,
          application,
          submission,
          {},
          fetchMock
        )
      ).resolves.toEqual({
        status: "failed",
        reason: "Meta CAPI hat das Ereignis abgelehnt",
        eventsReceived: undefined,
      });
      expect(consoleError).toHaveBeenCalledWith(
        "[Meta CAPI] Ereignis abgelehnt",
        {
          eventId: submission.metaEventId,
          pixelId: config.metaTracking.pixelId,
          httpStatus: 400,
          eventsReceived: undefined,
          traceId: "trace-error",
          errorType: "OAuthException",
          errorCode: 190,
          errorSubcode: 463,
        }
      );
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
        "Fehlerdetails mit potenziell sensiblen Angaben"
      );
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
        "EAAB-server-token-long-value"
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
