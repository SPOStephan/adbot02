import { z } from "zod";
import { FUNNEL_OPTION_ICONS, FUNNEL_STATUSES, META_CONVERSION_TRIGGERS, PAGE_TYPES } from "./funnel";

const iconSchema = z.enum(FUNNEL_OPTION_ICONS);
const optionalHttpsUrlSchema = z.string().max(2048).refine(value => value === "" || /^https:\/\//i.test(value), "Es ist nur eine absolute HTTPS-Adresse zulässig.");

const optionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(160),
  value: z.string().min(1).max(160),
  icon: iconSchema,
  description: z.string().max(500).optional(),
});

const pageBaseSchema = z.object({
  id: z.string().min(1),
  type: z.enum(PAGE_TYPES),
  name: z.string().min(1).max(120),
  eyebrow: z.string().max(160),
  title: z.string().min(1).max(300),
  description: z.string().max(1200),
  buttonLabel: z.string().min(1).max(100),
});

const startPageSchema = pageBaseSchema.extend({
  type: z.literal("start"),
  heroImageUrl: z.string().max(2048),
  bullets: z.array(z.string().min(1).max(240)).max(8),
  trustNote: z.string().max(300),
});

const choicePageSchema = pageBaseSchema.extend({
  type: z.enum(["choice-grid", "choice-list"]),
  questionKey: z.string().min(1).max(120),
  allowMultiple: z.boolean(),
  options: z.array(optionSchema).min(2).max(12),
});

const contactFieldSchema = z.object({
  key: z.enum(["name", "company", "email", "phone", "message"]),
  label: z.string().min(1).max(160),
  placeholder: z.string().max(240),
  enabled: z.boolean(),
  required: z.boolean(),
  inputType: z.enum(["text", "email", "tel", "textarea"]),
});

const contactPageSchema = pageBaseSchema.extend({
  type: z.literal("contact"),
  fields: z.array(contactFieldSchema).min(1).max(5),
  consentLabel: z.string().min(1).max(1200),
  consentRequired: z.boolean(),
  resumeEnabled: z.boolean(),
  resumeRequired: z.boolean(),
  resumeLabel: z.string().min(1).max(200),
  successTitle: z.string().min(1).max(300),
  successText: z.string().min(1).max(1200),
});

export const funnelPageSchema = z.discriminatedUnion("type", [
  startPageSchema,
  choicePageSchema.extend({ type: z.literal("choice-grid") }),
  choicePageSchema.extend({ type: z.literal("choice-list") }),
  contactPageSchema,
]);

export const funnelStatusSchema = z.enum(FUNNEL_STATUSES);
export const funnelIdSchema = z.string().uuid();

export const funnelConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: funnelIdSchema,
    slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/),
    title: z.string().min(1).max(240),
    status: funnelStatusSchema,
    isPublished: z.boolean(),
    notificationEmail: z.union([z.literal(""), z.string().email()]),
    allowedEmbedOrigins: z.array(z.string().url()).max(20),
    brand: z.object({
      logoUrl: z.string().max(2048),
      logoAlt: z.string().min(1).max(160),
      faviconUrl: z.string().max(2048).refine(value => value === "" || value.startsWith("/") || /^https?:\/\//i.test(value), "Favicon muss eine HTTPS-/HTTP- oder interne URL sein."),
      accentColor: z.literal("#0165c3"),
      backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      surfaceColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      choiceBackgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      choiceTextColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      choiceSelectedBackgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      choiceSelectedTextColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      choiceSelectedBorderColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    }),
    socialProof: z.object({
      enabled: z.boolean(),
      eyebrow: z.string().max(160),
      text: z.string().max(500),
    }),
    privacyUrl: z.string().url(),
    privacyLabel: z.string().min(1).max(160),
    legal: z.object({
      imprintTitle: z.string().trim().min(1, "Bitte gib eine Impressumsüberschrift ein.").max(160),
      imprintContent: z.string().trim().min(1, "Bitte gib den Impressumsinhalt ein.").max(20_000),
    }),
    postSubmit: z.object({
      mode: z.enum(["message", "redirect"]),
      redirectUrl: optionalHttpsUrlSchema,
    }),
    metaTracking: z.object({
      enabled: z.boolean(),
      pixelId: z.union([z.literal(""), z.string().regex(/^\d{5,25}$/, "Die Pixel-ID muss aus 5 bis 25 Ziffern bestehen.")]),
      eventName: z.string().trim().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Der Eventname darf nur Buchstaben, Ziffern und Unterstriche enthalten."),
      conversionTrigger: z.enum(META_CONVERSION_TRIGGERS).default("submit"),
    }),
    pages: z.array(funnelPageSchema).min(2).max(40),
  })
  .superRefine((config, ctx) => {
    if (config.isPublished !== (config.status === "published")) {
      ctx.addIssue({ code: "custom", path: ["isPublished"], message: "Veröffentlichungsstatus und Kompatibilitätsfeld widersprechen sich." });
    }
    if (config.pages[0]?.type !== "start") {
      ctx.addIssue({ code: "custom", path: ["pages", 0], message: "Die erste Seite muss eine Startseite sein." });
    }
    if (config.pages.at(-1)?.type !== "contact") {
      ctx.addIssue({ code: "custom", path: ["pages"], message: "Die letzte Seite muss eine Kontaktseite sein." });
    }
    const pageIds = config.pages.map(page => page.id);
    if (new Set(pageIds).size !== pageIds.length) {
      ctx.addIssue({ code: "custom", path: ["pages"], message: "Seiten-IDs müssen eindeutig sein." });
    }
    if (config.postSubmit.mode === "redirect" && !config.postSubmit.redirectUrl) {
      ctx.addIssue({ code: "custom", path: ["postSubmit", "redirectUrl"], message: "Für die Weiterleitung ist eine HTTPS-Adresse erforderlich." });
    }
    if (config.metaTracking.enabled && !config.metaTracking.pixelId) {
      ctx.addIssue({ code: "custom", path: ["metaTracking", "pixelId"], message: "Für aktives Meta-Tracking ist eine Pixel-ID erforderlich." });
    }
  });

export const createFunnelSchema = z.object({
  title: z.string().trim().min(1).max(240),
  slug: z.string().trim().max(120).optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  ownerEmail: z.string().trim().email().max(320).nullable().optional(),
});

export const duplicateFunnelSchema = createFunnelSchema.extend({
  sourceId: funnelIdSchema,
});

export const setFunnelOwnerSchema = z.object({
  funnelId: funnelIdSchema,
  ownerUserId: z.string().uuid().nullable(),
  ownerEmail: z.union([z.string().trim().email().max(320), z.literal(""), z.null()]).optional(),
});

export const applicationSubmissionSchema = z
  .object({
    funnelSlug: z.string().min(1).max(120),
    answers: z.record(z.string(), z.array(z.string().max(300)).max(12)),
    contact: z.object({
      name: z.string().max(240).optional(),
      company: z.string().max(240).optional(),
      email: z.string().email().max(320).optional(),
      phone: z.string().max(80).optional(),
      message: z.string().max(4000).optional(),
    }),
    consent: z.boolean(),
    metaEventId: z.string().uuid().optional(),
    metaFbp: z.string().max(255).optional(),
    metaFbc: z.string().max(255).optional(),
    sourceUrl: z.string().url().max(2048).optional(),
    utm: z.record(z.string(), z.string().max(500)).optional(),
    resume: z
      .object({
        fileName: z.string().min(1).max(240),
        mimeType: z.enum([
          "application/pdf",
          "application/msword",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ]),
        size: z.number().int().positive().max(8 * 1024 * 1024),
        dataBase64: z.string().min(1),
      })
      .optional(),
  });

export const applicationStatusSchema = z.enum(["new", "reviewing", "contacted", "rejected", "hired"]);
