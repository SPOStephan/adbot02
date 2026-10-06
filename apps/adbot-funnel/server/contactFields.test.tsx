import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplicationRecord, ContactFieldConfig, ContactPage, FunnelConfig } from "@shared/funnel";
import { defaultFunnel } from "@shared/defaultFunnel";
import { funnelPageSchema } from "@shared/funnelSchemas";
import {
  birthYearOptions,
  CONTACT_FIELD_PRESETS,
  contactFieldMissing,
  contactFieldValueError,
  createCustomContactField,
  sanitizePostalCityInput,
  splitPostalCity,
  resolveApplicationContactFields,
  sanitizeContactFieldInput,
} from "@shared/contactFields";
import { ContactStep } from "../client/src/components/funnel/ContactStep";
import type { TrpcContext } from "./_core/context";
import { buildApplicationsCsv, buildApplicationsPdf } from "./exports";
import { resetMemoryStoreForTests } from "./funnelStore";
import { buildApplicationNotificationHtml } from "./mail";
import { appRouter } from "./routers";

vi.mock("./storage", () => ({ storagePut: vi.fn() }));
vi.mock("./bunny", () => ({ isBunnyConfigured: () => false, uploadFunnelBytesToBunny: vi.fn() }));

const custom: ContactFieldConfig = { ...createCustomContactField([]), label: "Mitgliedsnummer", charset: "digits", required: true };

function configWithExtraFields(): FunnelConfig {
  const config = structuredClone(defaultFunnel);
  const page = config.pages.find((candidate): candidate is ContactPage => candidate.type === "contact")!;
  const messageIndex = page.fields.findIndex(field => field.key === "message");
  page.fields.splice(messageIndex, 0, { ...CONTACT_FIELD_PRESETS.birthYear }, { ...CONTACT_FIELD_PRESETS.postalCode, required: true }, { ...CONTACT_FIELD_PRESETS.city }, custom, { ...CONTACT_FIELD_PRESETS.postalCodeCity, required: true });
  return config;
}

describe("Zusätzliche Kontaktfelder", () => {
  it("bietet Geburtsjahre von 2006 bis 1950 an und prüft Zahlen- und Buchstabenfelder", () => {
    const years = birthYearOptions(CONTACT_FIELD_PRESETS.birthYear);
    expect(years[0]).toBe("2006");
    expect(years.at(-1)).toBe("1950");
    expect(years).toContain("1980");
    expect(contactFieldValueError(CONTACT_FIELD_PRESETS.birthYear, "1949")).toBeDefined();
    expect(contactFieldValueError(CONTACT_FIELD_PRESETS.birthYear, "1980")).toBeUndefined();

    expect(sanitizeContactFieldInput(CONTACT_FIELD_PRESETS.postalCode, "12a34-567")).toBe("12345");
    expect(contactFieldValueError(CONTACT_FIELD_PRESETS.postalCode, "12a45")).toMatch(/nur Zahlen/);
    expect(sanitizeContactFieldInput(CONTACT_FIELD_PRESETS.city, "Bad Homburg v. d. Höhe 1")).toBe("Bad Homburg v. d. Höhe ");
    expect(contactFieldValueError(CONTACT_FIELD_PRESETS.city, "Köln 5")).toMatch(/nur Buchstaben/);
    expect(contactFieldValueError(CONTACT_FIELD_PRESETS.city, "Sankt-Peter-Ording")).toBeUndefined();
    expect(createCustomContactField(["custom1", "custom2"]).key).toBe("custom3");
  });

  it("führt PLZ und Wohnort als ein Feld mit einem Wert", () => {
    const field = CONTACT_FIELD_PRESETS.postalCodeCity;
    expect(sanitizePostalCityInput(field, "50a6678", "Köln 1")).toBe("50667 Köln ");
    expect(sanitizePostalCityInput(field, "50667", "")).toBe("50667");
    expect(splitPostalCity("50667 Bad Homburg v. d. Höhe")).toEqual({ postalCode: "50667", city: "Bad Homburg v. d. Höhe" });
    expect(splitPostalCity(" Köln")).toEqual({ postalCode: "", city: "Köln" });
    expect(contactFieldMissing(field, "50667")).toBe(true);
    expect(contactFieldMissing(field, "50667 Köln")).toBe(false);
    expect(contactFieldValueError(field, "50667 Köln")).toBeUndefined();
    expect(contactFieldValueError(field, "50667")).toMatch(/PLZ und Wohnort/);
    expect(contactFieldValueError(field, "506670 Köln")).toMatch(/höchstens 5/);
    expect(contactFieldValueError(field, "50667 Köln 5")).toMatch(/nur Buchstaben/);
    expect(contactFieldValueError({ ...field, maxLength: 4 }, "1010 Wien")).toBeUndefined();
  });

  it("akzeptiert eigene Felder im Seitenschema und lehnt doppelte Schlüssel ab", () => {
    const page = configWithExtraFields().pages.find(candidate => candidate.type === "contact")!;
    expect(funnelPageSchema.safeParse(page).success).toBe(true);
    const duplicate = structuredClone(page) as ContactPage;
    duplicate.fields.push({ ...custom });
    expect(funnelPageSchema.safeParse(duplicate).success).toBe(false);
  });

  it("rendert Geburtsjahr als Auswahl und PLZ als Zahlenfeld", () => {
    const page = configWithExtraFields().pages.find((candidate): candidate is ContactPage => candidate.type === "contact")!;
    const html = renderToStaticMarkup(
      <ContactStep page={page} contact={{}} consent={false} pending={false} onContactChange={vi.fn()} onConsentChange={vi.fn()} onResumeChange={vi.fn()} onFileError={vi.fn()} onBack={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(html).toMatch(new RegExp(`<button[^>]*id="${page.id}-birthYear"[^>]*aria-haspopup="listbox"`));
    const postalInput = html.match(new RegExp(`<input[^>]*id="${page.id}-postalCode"[^>]*>`))?.[0];
    expect(postalInput).toContain('inputMode="numeric"');
    expect(postalInput).toContain('maxLength="5"');
    expect(postalInput).toContain('autoComplete="postal-code"');
    const combined = html.match(new RegExp(`<div class="funnel-postal-city">.*?</div>`))?.[0];
    expect(combined).toContain(`id="${page.id}-postalCodeCity"`);
    expect(combined).toContain(`id="${page.id}-postalCodeCity-city"`);
  });

  it("zeigt Zusatzfelder mit Beschriftung in Mail, CSV und PDF in der Reihenfolge der Kontaktseite", async () => {
    const config = configWithExtraFields();
    const application: ApplicationRecord = {
      id: "20000000-0000-4000-8000-000000000009",
      funnelId: config.id,
      funnelSlug: config.slug,
      status: "new",
      answers: {},
      contact: { name: "Erika Muster", email: "erika@example.org", city: "Köln", postalCode: "50667", birthYear: "1984", custom1: "4711", postalCodeCity: "50667 Köln" },
      contactLabels: { birthYear: "Geburtsjahr", postalCode: "PLZ", city: "Wohnort", custom1: "Mitgliedsnummer", postalCodeCity: "PLZ und Wohnort" },
      consentAt: "2026-10-06T08:00:00.000Z",
      utm: {},
      createdAt: "2026-10-06T08:00:00.000Z",
    };

    expect(resolveApplicationContactFields(config, application.contact, application.contactLabels).map(field => field.label))
      .toEqual(["Name", "E-Mail", "Geburtsjahr", "PLZ", "Wohnort", "Mitgliedsnummer", "PLZ und Wohnort"]);

    const html = buildApplicationNotificationHtml(config, application);
    expect(html).toContain(">Geburtsjahr<");
    expect(html).toContain("<strong>1984</strong>");
    expect(html).toContain(">Mitgliedsnummer<");
    expect(html).toContain(">E-Mail<");
    expect(html).not.toContain(">custom1<");
    expect(html).toContain(">PLZ und Wohnort<");
    expect(html).toContain("<strong>50667 Köln</strong>");

    const [header, row] = buildApplicationsCsv([application], [config]).replace("﻿", "").split("\r\n");
    expect(header).toContain('"Nachricht";"Geburtsjahr";"PLZ";"Wohnort";"Mitgliedsnummer";"PLZ und Wohnort"');
    expect(row).toContain('"";"1984";"50667";"Köln";"4711";"50667 Köln"');

    const pdf = await buildApplicationsPdf([{ ...application, contact: { ...application.contact, city: "Koeln", postalCodeCity: "50667 Koeln" } }], [config]);
    expect(pdf.byteLength).toBeGreaterThan(500);
  });
});

const adminContext: TrpcContext = {
  user: {
    id: 99,
    openId: "contact-fields-admin",
    email: "admin@example.org",
    name: "Admin",
    loginMethod: "password",
    role: "admin",
    createdAt: new Date("2026-10-06T10:00:00.000Z"),
    updatedAt: new Date("2026-10-06T10:00:00.000Z"),
    lastSignedIn: new Date("2026-10-06T10:00:00.000Z"),
  },
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
};
const publicContext: TrpcContext = { ...adminContext, user: null };

describe("Zusätzliche Kontaktfelder im Router", () => {
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  beforeAll(() => { delete process.env.SUPABASE_URL; });
  beforeEach(() => resetMemoryStoreForTests());
  afterAll(() => {
    if (originalSupabaseUrl) process.env.SUPABASE_URL = originalSupabaseUrl;
    resetMemoryStoreForTests();
  });

  it("prüft Pflicht- und Zeichenregeln, verwirft fremde Felder und hält die Beschriftung fest", async () => {
    const admin = appRouter.createCaller(adminContext);
    const visitor = appRouter.createCaller(publicContext);
    const { config } = await admin.funnel.adminConfig();
    const extended = configWithExtraFields();
    await admin.funnel.saveConfig({ ...config, pages: config.pages.map(page => page.type === "contact" ? extended.pages.find(candidate => candidate.type === "contact")! : page), notificationEmailWrite: "preserve" });

    const base = {
      funnelSlug: config.slug,
      answers: { arbeitsbereich: ["vertrieb"], berufserfahrung: ["3-plus"] },
      consent: true,
    };
    const contact = { name: "Erika Muster", email: "erika@example.org", phone: "+49 123", postalCode: "50667", custom1: "4711", postalCodeCity: "50667 Köln" };

    await expect(visitor.funnel.submit({ ...base, contact: { ...contact, postalCode: "" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(visitor.funnel.submit({ ...base, contact: { ...contact, postalCode: "5O667" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(visitor.funnel.submit({ ...base, contact: { ...contact, birthYear: "2015" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(visitor.funnel.submit({ ...base, contact: { ...contact, postalCodeCity: "50667" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const result = await visitor.funnel.submit({ ...base, contact: { ...contact, birthYear: "1984", city: "Köln", unbekannt: "x" } });
    const before = await admin.funnel.application({ id: result.id });
    expect(before.contact).not.toHaveProperty("unbekannt");
    expect(before.extraContactFields.map(field => [field.label, field.value])).toEqual([
      ["Geburtsjahr", "1984"],
      ["PLZ", "50667"],
      ["Wohnort", "Köln"],
      ["Mitgliedsnummer", "4711"],
      ["PLZ und Wohnort", "50667 Köln"],
    ]);

    const current = (await admin.funnel.adminConfig({ id: config.id })).config;
    await admin.funnel.saveConfig({
      ...current,
      pages: current.pages.map(page => page.type === "contact"
        ? { ...page, fields: page.fields.map(field => field.key === "custom1" ? { ...field, label: "Kundennummer" } : field) }
        : page),
      notificationEmailWrite: "preserve",
    });
    const after = await admin.funnel.application({ id: result.id });
    expect(after.extraContactFields.find(field => field.key === "custom1")?.label).toBe("Mitgliedsnummer");
  });
});
