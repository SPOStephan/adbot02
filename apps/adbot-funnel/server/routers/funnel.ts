import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { defaultFunnel } from "@shared/defaultFunnel";
import {
  applicationStatusSchema,
  applicationSubmissionSchema,
  createFunnelSchema,
  duplicateFunnelSchema,
  funnelConfigSchema,
  funnelIdSchema,
  funnelStatusSchema,
  setFunnelOwnerSchema,
} from "@shared/funnelSchemas";
import type { ApplicationSubmission, FunnelConfig, ResumeMetadata } from "@shared/funnel";
import type { User } from "../../drizzle/schema";
import { storagePut } from "../storage";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import { getTenantOwnerUserId, isPlatformAdmin } from "../_core/session";
import {
  createApplication,
  createFunnel,
  createFunnelFromTemplate,
  getApplication,
  getFunnel,
  getFunnelById,
  getMetaServerSettingsSummary,
  getOrCreateDefaultFunnel,
  getUniqueFunnelSlug,
  isPersistentStoreConfigured,
  listApplications,
  listFunnels,
  saveFunnel,
  saveMetaServerSettings,
  getFunnelOwner,
  setFunnelOwner,
  slugifyFunnel,
  updateApplicationStatus,
} from "../funnelStore";
import { sendApplicationNotification } from "../mail";
import { buildApplicationsCsv, buildApplicationsPdf } from "../exports";
import { sendMetaApplicationConversion } from "../metaConversions";
import { resolveApplicationAnswers } from "@shared/applicationAnswers";
import {
  listCustomDomainsForFunnel,
  markCustomDomainReady,
  registerCustomDomain,
  revokeCustomDomain,
} from "../funnelCustomDomains";

function validateSubmission(config: FunnelConfig, submission: z.infer<typeof applicationSubmissionSchema>) {
  if (config.status !== "published") throw new TRPCError({ code: "NOT_FOUND", message: "Dieser Funnel ist derzeit nicht veröffentlicht." });
  const contactPage = config.pages.find(page => page.type === "contact");
  if (!contactPage || contactPage.type !== "contact") throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Kontaktseite fehlt." });
  for (const page of config.pages) {
    if (page.type !== "choice-grid" && page.type !== "choice-list") continue;
    const values = submission.answers[page.questionKey] ?? [];
    if (values.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: `Bitte beantworte: ${page.title}` });
    if (!page.allowMultiple && values.length > 1) throw new TRPCError({ code: "BAD_REQUEST", message: `Für „${page.title}“ ist nur eine Antwort zulässig.` });
    const allowedValues = new Set(page.options.map(option => option.value));
    if (values.some(value => !allowedValues.has(value))) throw new TRPCError({ code: "BAD_REQUEST", message: `Ungültige Antwort für „${page.title}“.` });
  }
  if (contactPage.consentRequired && !submission.consent) throw new TRPCError({ code: "BAD_REQUEST", message: "Die Datenschutz-Einwilligung ist erforderlich." });
  for (const field of contactPage.fields) {
    if (field.enabled && field.required && !submission.contact[field.key]?.trim()) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `${field.label} ist ein Pflichtfeld.` });
    }
  }
  if (contactPage.resumeEnabled && contactPage.resumeRequired && !submission.resume) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Bitte lade deinen Lebenslauf hoch." });
  }
}

async function requireFunnel(id: string) {
  const config = await getFunnelById(id);
  if (!config) throw new TRPCError({ code: "NOT_FOUND", message: "Funnel nicht gefunden." });
  return config;
}

async function requireOwnedFunnel(id: string, user: User) {
  const config = await requireFunnel(id);
  if (isPlatformAdmin(user)) return config;

  const owner = await getFunnelOwner(id);
  if (!owner?.userId || owner.userId !== user.openId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Funnel nicht gefunden." });
  }
  return config;
}

async function assertSlugAvailable(slug: string, currentId?: string) {
  const existing = await getFunnel(slug);
  if (existing && existing.id !== currentId) {
    throw new TRPCError({ code: "CONFLICT", message: "Dieser URL-Slug wird bereits von einem anderen Funnel verwendet." });
  }
}

async function applicationsWithConfigs(funnelId: string | undefined, user: User) {
  let applications;
  if (funnelId) {
    await requireOwnedFunnel(funnelId, user);
    applications = await listApplications(funnelId);
  } else if (isPlatformAdmin(user)) {
    applications = await listApplications();
  } else {
    const owned = await listFunnels({ ownerUserId: user.openId });
    const batches = await Promise.all(owned.map(item => listApplications(item.id)));
    applications = batches.flat();
  }

  const funnelIds = Array.from(new Set(applications.map(application => application.funnelId)));
  const configs = (await Promise.all(funnelIds.map(id => getFunnelById(id))))
    .filter((config): config is FunnelConfig => Boolean(config));
  return { applications, configs };
}

const optionalFunnelFilter = z.object({ funnelId: funnelIdSchema.optional() }).optional();
const faviconUploadSchema = z.object({
  funnelId: funnelIdSchema,
  fileName: z.string().min(1).max(160),
  mimeType: z.enum(["image/png", "image/x-icon", "image/vnd.microsoft.icon"]),
  size: z.number().int().positive().max(512 * 1024),
  dataBase64: z.string().min(1).max(1_000_000),
});

const metaServerSettingsSchema = z.object({
  funnelId: funnelIdSchema,
  accessToken: z.string().trim().min(20).max(4096).optional(),
  clearAccessToken: z.boolean().default(false),
  testEventCode: z.string().trim().max(160).default(""),
});

function hasValidFaviconSignature(buffer: Buffer, mimeType: z.infer<typeof faviconUploadSchema>["mimeType"]) {
  if (mimeType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return buffer.length >= signature.length && signature.every((value, index) => buffer[index] === value);
  }
  return buffer.length >= 4 && buffer[0] === 0 && buffer[1] === 0 && buffer[2] === 1 && buffer[3] === 0;
}

function ownerFromUser(user: User) {
  return {
    userId: user.openId,
    email: user.email ?? null,
  };
}

export const funnelRouter = router({
  publicConfig: publicProcedure.input(z.object({ slug: z.string().min(1) })).query(async ({ input }) => {
    const config = await getFunnel(input.slug);
    const fallback = input.slug === "karriere" ? await getOrCreateDefaultFunnel() : null;
    const result = config ?? fallback;
    if (!result || result.status !== "published") throw new TRPCError({ code: "NOT_FOUND", message: "Funnel nicht gefunden." });
    return { ...result, notificationEmail: "", allowedEmbedOrigins: [] };
  }),

  submit: publicProcedure.input(applicationSubmissionSchema).mutation(async ({ input, ctx }) => {
    const config = (await getFunnel(input.funnelSlug)) ?? (input.funnelSlug === "karriere" ? await getOrCreateDefaultFunnel() : null);
    if (!config) throw new TRPCError({ code: "NOT_FOUND", message: "Funnel nicht gefunden." });
    validateSubmission(config, input);

    let resume: ResumeMetadata | undefined;
    if (input.resume) {
      const buffer = Buffer.from(input.resume.dataBase64, "base64");
      if (buffer.byteLength !== input.resume.size || buffer.byteLength > 8 * 1024 * 1024) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Die Lebenslauf-Datei ist ungültig oder zu groß." });
      }
      const safeName = input.resume.fileName.replace(/[^a-zA-Z0-9äöüÄÖÜß._-]/g, "-");
      const stored = await storagePut(`applications/${crypto.randomUUID()}/${safeName}`, buffer, input.resume.mimeType);
      resume = { key: stored.key, url: stored.url, fileName: input.resume.fileName, mimeType: input.resume.mimeType, size: input.resume.size };
    }

    const submission: ApplicationSubmission = { ...input, resume };
    const application = await createApplication(submission);
    const forwardedFor = ctx.req.headers["x-forwarded-for"];
    const clientIp = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(",")[0])?.trim()
      || ctx.req.headers["x-real-ip"]?.toString()
      || ctx.req.socket?.remoteAddress;
    const requestMetadata = { clientIp, userAgent: ctx.req.headers["user-agent"] };
    const [notificationSent, metaConversion] = await Promise.all([
      sendApplicationNotification(config, application).catch(error => {
        console.error("[Funnel] E-Mail-Benachrichtigung fehlgeschlagen", error);
        return false;
      }),
      sendMetaApplicationConversion(config, application, submission, requestMetadata),
    ]);
    return { id: application.id, notificationSent, metaConversion: metaConversion.status };
  }),

  funnels: adminProcedure.query(({ ctx }) => {
    const ownerUserId = getTenantOwnerUserId(ctx.user);
    return listFunnels(ownerUserId ? { ownerUserId } : undefined);
  }),

  adminConfig: adminProcedure
    .input(z.object({ id: funnelIdSchema }).optional())
    .query(async ({ input, ctx }) => {
      let config: FunnelConfig;
      if (input?.id) {
        config = await requireOwnedFunnel(input.id, ctx.user);
      } else if (isPlatformAdmin(ctx.user)) {
        config = await getOrCreateDefaultFunnel();
      } else {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Funnel-ID ist erforderlich." });
      }
      return {
        config,
        metaServerSettings: await getMetaServerSettingsSummary(config.id),
        persistentStoreConfigured: isPersistentStoreConfigured(),
        emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM),
      };
    }),

  create: adminProcedure.input(createFunnelSchema).mutation(async ({ input, ctx }) => {
    const slug = await getUniqueFunnelSlug(input.slug || input.title);
    const config = createFunnelFromTemplate(defaultFunnel, input.title, slug);
    const owner = isPlatformAdmin(ctx.user)
      ? {
          userId: input.ownerUserId ?? null,
          email: input.ownerEmail ?? null,
        }
      : ownerFromUser(ctx.user);
    return createFunnel(config, owner);
  }),

  duplicate: adminProcedure.input(duplicateFunnelSchema).mutation(async ({ input, ctx }) => {
    const source = await requireOwnedFunnel(input.sourceId, ctx.user);
    const slug = await getUniqueFunnelSlug(input.slug || input.title);
    const copy = createFunnelFromTemplate(source, input.title, slug);
    const sourceOwner = await getFunnelOwner(source.id);
    const owner = isPlatformAdmin(ctx.user)
      ? {
          userId: input.ownerUserId ?? sourceOwner?.userId ?? null,
          email: input.ownerEmail ?? sourceOwner?.email ?? null,
        }
      : ownerFromUser(ctx.user);
    return createFunnel(copy, owner);
  }),

  setOwner: adminProcedure.input(setFunnelOwnerSchema).mutation(async ({ input, ctx }) => {
    if (!isPlatformAdmin(ctx.user)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Nur Plattform-Admins dürfen den Owner ändern." });
    }
    await requireFunnel(input.funnelId);
    const summary = await setFunnelOwner(input.funnelId, {
      userId: input.ownerUserId,
      email: input.ownerEmail === "" ? null : input.ownerEmail ?? null,
    });
    if (!summary) throw new TRPCError({ code: "NOT_FOUND", message: "Funnel nicht gefunden." });
    return summary;
  }),

  uploadFavicon: adminProcedure.input(faviconUploadSchema).mutation(async ({ input, ctx }) => {
    await requireOwnedFunnel(input.funnelId, ctx.user);
    const buffer = Buffer.from(input.dataBase64, "base64");
    if (buffer.byteLength !== input.size || !hasValidFaviconSignature(buffer, input.mimeType)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Die Favicon-Datei ist beschädigt oder hat ein nicht unterstütztes Format." });
    }
    const extension = input.mimeType === "image/png" ? "png" : "ico";
    const contentType = input.mimeType === "image/png" ? "image/png" : "image/x-icon";
    return storagePut(`funnels/${input.funnelId}/branding/favicon-${crypto.randomUUID()}.${extension}`, buffer, contentType);
  }),

  saveConfig: adminProcedure.input(funnelConfigSchema).mutation(async ({ input, ctx }) => {
    await requireOwnedFunnel(input.id, ctx.user);
    const slug = slugifyFunnel(input.slug);
    await assertSlugAvailable(slug, input.id);
    return saveFunnel({ ...input, slug, isPublished: input.status === "published" });
  }),

  saveMetaServerSettings: adminProcedure.input(metaServerSettingsSchema).mutation(async ({ input, ctx }) => {
    await requireOwnedFunnel(input.funnelId, ctx.user);
    return saveMetaServerSettings(input.funnelId, input);
  }),

  customDomains: adminProcedure
    .input(z.object({ funnelId: funnelIdSchema }))
    .query(async ({ input, ctx }) => {
      await requireOwnedFunnel(input.funnelId, ctx.user);
      return listCustomDomainsForFunnel(input.funnelId);
    }),

  registerCustomDomain: adminProcedure
    .input(
      z.object({
        funnelId: funnelIdSchema,
        hostname: z.string().min(3).max(253),
        notes: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await requireOwnedFunnel(input.funnelId, ctx.user);
      try {
        return await registerCustomDomain({
          funnelId: input.funnelId,
          hostname: input.hostname,
          notes: input.notes,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Custom Domain konnte nicht registriert werden.",
        });
      }
    }),

  markCustomDomainReady: adminProcedure
    .input(z.object({ funnelId: funnelIdSchema, domainId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireOwnedFunnel(input.funnelId, ctx.user);
      try {
        return await markCustomDomainReady(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Custom Domain konnte nicht als bereit markiert werden.",
        });
      }
    }),

  revokeCustomDomain: adminProcedure
    .input(z.object({ funnelId: funnelIdSchema, domainId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireOwnedFunnel(input.funnelId, ctx.user);
      try {
        return await revokeCustomDomain(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Custom Domain konnte nicht zurückgezogen werden.",
        });
      }
    }),

  setFunnelStatus: adminProcedure
    .input(z.object({ id: funnelIdSchema, status: funnelStatusSchema }))
    .mutation(async ({ input, ctx }) => {
      const config = await requireOwnedFunnel(input.id, ctx.user);
      return saveFunnel({ ...config, status: input.status, isPublished: input.status === "published" });
    }),

  applications: adminProcedure.input(optionalFunnelFilter).query(async ({ input, ctx }) => {
    if (input?.funnelId) {
      await requireOwnedFunnel(input.funnelId, ctx.user);
      return listApplications(input.funnelId);
    }
    if (isPlatformAdmin(ctx.user)) return listApplications();
    const owned = await listFunnels({ ownerUserId: ctx.user.openId });
    const batches = await Promise.all(owned.map(item => listApplications(item.id)));
    return batches.flat();
  }),

  application: adminProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input, ctx }) => {
    const application = await getApplication(input.id);
    if (!application) throw new TRPCError({ code: "NOT_FOUND", message: "Bewerbung nicht gefunden." });
    await requireOwnedFunnel(application.funnelId, ctx.user);
    const config = await getFunnelById(application.funnelId) ?? await getFunnel(application.funnelSlug) ?? undefined;
    return { ...application, displayAnswers: resolveApplicationAnswers(config, application.answers) };
  }),

  updateStatus: adminProcedure
    .input(z.object({ id: z.string().uuid(), status: applicationStatusSchema }))
    .mutation(async ({ input, ctx }) => {
      const existing = await getApplication(input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Bewerbung nicht gefunden." });
      await requireOwnedFunnel(existing.funnelId, ctx.user);
      const application = await updateApplicationStatus(input.id, input.status);
      if (!application) throw new TRPCError({ code: "NOT_FOUND", message: "Bewerbung nicht gefunden." });
      return application;
    }),

  exportCsv: adminProcedure.input(optionalFunnelFilter).mutation(async ({ input, ctx }) => {
    const { applications, configs } = await applicationsWithConfigs(input?.funnelId, ctx.user);
    return {
      fileName: `bewerbungen-${new Date().toISOString().slice(0, 10)}.csv`,
      mimeType: "text/csv;charset=utf-8",
      dataBase64: Buffer.from(buildApplicationsCsv(applications, configs), "utf8").toString("base64"),
    };
  }),

  exportPdf: adminProcedure.input(optionalFunnelFilter).mutation(async ({ input, ctx }) => {
    const { applications, configs } = await applicationsWithConfigs(input?.funnelId, ctx.user);
    return {
      fileName: `bewerbungen-${new Date().toISOString().slice(0, 10)}.pdf`,
      mimeType: "application/pdf",
      dataBase64: (await buildApplicationsPdf(applications, configs)).toString("base64"),
    };
  }),
});
