import { z } from "zod";
import { COOKIE_NAME, ONE_YEAR_MS } from "../shared/const";
import { TRPCError } from "@trpc/server";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import {
  buildAdminUser,
  createSessionToken,
  getTenantOwnerUserId,
  isPlatformAdmin,
  verifyAdminPassword,
} from "./_core/session";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import {
  buildDeliveryMail,
  buildDoiMail,
  buildOtpMail,
  sendTransactionalMail,
} from "./mail";
import {
  confirmLeadByDoiToken,
  confirmLeadByOtp,
  createMediaAssetFromUpload,
  createPendingLead,
  getOfferById,
  getPublishedOfferBySlug,
  listLeadsForOffer,
  listOffers,
  markLeadDelivered,
  resolveDownloadUrl,
  upsertOffer,
} from "./freebieStore";
import { checkCustomDomainCname } from "./customDomainDns";
import {
  getCustomDomainForOffer,
  getOfferIdByCustomHostname,
  listCustomDomainsForOffer,
  markCustomDomainReady,
  registerCustomDomain,
  revokeCustomDomain,
} from "./freebieCustomDomains";
import { resolvePublicAppBaseUrl } from "./publicAppUrl";
import {
  listPortalDomainsForFreebie,
  pushFreebieDomainRevokeToPortal,
  pushFreebieDomainUpsertToPortal,
} from "./portalDomainSync";
import {
  isSharedFreebieHost,
  normalizeHostname,
} from "../shared/freebieHosts";

const confirmationModeSchema = z.enum(["doi", "otp"]);

function publicOfferPayload(offer: NonNullable<Awaited<ReturnType<typeof getOfferById>>>) {
  return {
    slug: offer.slug,
    title: offer.title,
    description: offer.description,
    confirmationMode: offer.confirmationMode,
    hasFile: Boolean(offer.mediaAssetId),
    metaTracking: {
      enabled: offer.metaTracking.enabled,
      pixelId: offer.metaTracking.pixelId,
      eventName: offer.metaTracking.eventName,
    },
  };
}

async function assertOfferAccess(offerId: string, user: NonNullable<Parameters<typeof getTenantOwnerUserId>[0]>) {
  const offer = await getOfferById(offerId);
  if (!offer) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Freebie nicht gefunden." });
  }
  if (!isPlatformAdmin(user) && offer.ownerUserId !== user.openId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Kein Zugriff auf dieses Freebie." });
  }
  return offer;
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    login: publicProcedure
      .input(
        z.object({
          email: z.string().trim().email().max(320),
          password: z.string().min(1).max(200),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        if (!verifyAdminPassword(input.email, input.password)) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "E-Mail oder Passwort ist ungültig.",
          });
        }

        const user = buildAdminUser(input.email.trim().toLowerCase());
        const sessionToken = await createSessionToken(user);
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, {
          ...cookieOptions,
          maxAge: ONE_YEAR_MS,
        });

        return { user };
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, cookieOptions);
      return { ok: true };
    }),
  }),
  freebies: router({
    list: adminProcedure.query(async ({ ctx }) => {
      const ownerUserId = getTenantOwnerUserId(ctx.user);
      return listOffers(ownerUserId);
    }),
    get: adminProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => assertOfferAccess(input.id, ctx.user)),
    upsert: adminProcedure
      .input(
        z.object({
          id: z.string().uuid().optional(),
          title: z.string().trim().min(2).max(160),
          description: z.string().trim().max(2000).default(""),
          confirmationMode: confirmationModeSchema,
          slug: z.string().trim().max(64).optional(),
          mediaAssetId: z.string().uuid().nullable().optional(),
          isPublished: z.boolean().optional(),
          metaTracking: z
            .object({
              enabled: z.boolean(),
              pixelId: z.union([
                z.literal(""),
                z.string().regex(/^\d{5,25}$/),
              ]),
              eventName: z
                .string()
                .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
                .max(64)
                .default("Lead"),
            })
            .optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (input.id) await assertOfferAccess(input.id, ctx.user);
        return upsertOffer({
          id: input.id,
          ownerUserId: getTenantOwnerUserId(ctx.user),
          ownerEmail: ctx.user.email,
          title: input.title,
          description: input.description,
          confirmationMode: input.confirmationMode,
          slug: input.slug,
          mediaAssetId: input.mediaAssetId,
          isPublished: input.isPublished,
          metaTracking: input.metaTracking,
        });
      }),
    uploadAsset: adminProcedure
      .input(
        z.object({
          offerId: z.string().uuid(),
          filename: z.string().trim().min(1).max(200),
          contentType: z.string().trim().min(1).max(120),
          dataBase64: z.string().min(1).max(12_000_000),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const offer = await assertOfferAccess(input.offerId, ctx.user);
        const asset = await createMediaAssetFromUpload({
          ownerUserId: offer.ownerUserId,
          filename: input.filename,
          contentType: input.contentType,
          dataBase64: input.dataBase64,
        });
        const updated = await upsertOffer({
          id: offer.id,
          ownerUserId: offer.ownerUserId,
          ownerEmail: offer.ownerEmail,
          title: offer.title,
          description: offer.description,
          confirmationMode: offer.confirmationMode,
          slug: offer.slug,
          mediaAssetId: asset.id,
          isPublished: offer.isPublished,
        });
        return { asset, offer: updated };
      }),
    leads: adminProcedure
      .input(z.object({ offerId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertOfferAccess(input.offerId, ctx.user);
        return listLeadsForOffer(input.offerId);
      }),
    customDomains: adminProcedure
      .input(z.object({ offerId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertOfferAccess(input.offerId, ctx.user);
        return listCustomDomainsForOffer(input.offerId);
      }),
    registerCustomDomain: adminProcedure
      .input(
        z.object({
          offerId: z.string().uuid(),
          hostname: z.string().trim().min(3).max(253),
          notes: z.string().trim().max(500).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const offer = await assertOfferAccess(input.offerId, ctx.user);
        try {
          const domain = await registerCustomDomain({
            offerId: input.offerId,
            hostname: input.hostname,
            notes: input.notes,
          });
          void pushFreebieDomainUpsertToPortal({
            ownerUserId: getTenantOwnerUserId(ctx.user),
            hostname: domain.hostname,
            status: domain.status === "READY" ? "READY" : "PENDING_DNS",
            dnsTarget: domain.dnsTarget,
            offerId: offer.id,
            offerTitle: offer.title,
            toolDomainId: domain.id,
          });
          return domain;
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error
                ? error.message
                : "Domain konnte nicht registriert werden.",
          });
        }
      }),
    portalDomains: adminProcedure.query(async ({ ctx }) => {
      return listPortalDomainsForFreebie({
        ownerUserId: getTenantOwnerUserId(ctx.user),
      });
    }),
    bindPortalDomain: adminProcedure
      .input(
        z.object({
          offerId: z.string().uuid(),
          hostname: z.string().trim().min(3).max(253),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const offer = await assertOfferAccess(input.offerId, ctx.user);
        const portalDomains = await listPortalDomainsForFreebie({
          ownerUserId: getTenantOwnerUserId(ctx.user),
        });
        const match = portalDomains.find(
          domain =>
            domain.hostname === normalizeHostname(input.hostname) &&
            (domain.bindingKind === "none" ||
              (domain.bindingKind === "freebie" &&
                domain.bindingRef === input.offerId)),
        );
        if (!match) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Domain nicht in Adbot gefunden oder bereits an Funnel/anderes Freebie gebunden.",
          });
        }
        if (match.bindingKind === "funnel") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Diese Domain ist bereits an einen Funnel gebunden.",
          });
        }
        try {
          const domain = await registerCustomDomain({
            offerId: input.offerId,
            hostname: match.hostname,
          });
          let result = domain;
          if (match.status === "READY") {
            const dns = await checkCustomDomainCname(
              domain.hostname,
              domain.dnsTarget,
            );
            if (dns.ok) {
              result = await markCustomDomainReady({
                offerId: input.offerId,
                domainId: domain.id,
              });
            }
          }
          void pushFreebieDomainUpsertToPortal({
            ownerUserId: getTenantOwnerUserId(ctx.user),
            hostname: result.hostname,
            status: result.status === "READY" ? "READY" : "PENDING_DNS",
            dnsTarget: result.dnsTarget,
            offerId: offer.id,
            offerTitle: offer.title,
            toolDomainId: result.id,
          });
          return result;
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error
                ? error.message
                : "Portal-Domain konnte nicht gebunden werden.",
          });
        }
      }),
    markCustomDomainReady: adminProcedure
      .input(
        z.object({
          offerId: z.string().uuid(),
          domainId: z.string().uuid(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const offer = await assertOfferAccess(input.offerId, ctx.user);
        const domain = await getCustomDomainForOffer(input);
        if (!domain) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Custom Domain nicht gefunden.",
          });
        }
        const dns = await checkCustomDomainCname(
          domain.hostname,
          domain.dnsTarget,
        );
        if (!dns.ok) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: dns.message,
          });
        }
        try {
          const ready = await markCustomDomainReady(input);
          void pushFreebieDomainUpsertToPortal({
            ownerUserId: getTenantOwnerUserId(ctx.user),
            hostname: ready.hostname,
            status: "READY",
            dnsTarget: ready.dnsTarget,
            offerId: offer.id,
            offerTitle: offer.title,
            toolDomainId: ready.id,
          });
          return ready;
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error
                ? error.message
                : "Domain konnte nicht aktiviert werden.",
          });
        }
      }),
    verifyCustomDomainDns: adminProcedure
      .input(
        z.object({
          offerId: z.string().uuid(),
          domainId: z.string().uuid(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await assertOfferAccess(input.offerId, ctx.user);
        const domain = await getCustomDomainForOffer(input);
        if (!domain) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Custom Domain nicht gefunden.",
          });
        }
        return checkCustomDomainCname(domain.hostname, domain.dnsTarget);
      }),
    revokeCustomDomain: adminProcedure
      .input(
        z.object({
          offerId: z.string().uuid(),
          domainId: z.string().uuid(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await assertOfferAccess(input.offerId, ctx.user);
        try {
          const revoked = await revokeCustomDomain(input);
          void pushFreebieDomainRevokeToPortal({
            ownerUserId: getTenantOwnerUserId(ctx.user),
            hostname: revoked.hostname,
            toolDomainId: revoked.id,
          });
          return revoked;
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error
                ? error.message
                : "Domain konnte nicht zurückgezogen werden.",
          });
        }
      }),
  }),
  public: router({
    offer: publicProcedure
      .input(z.object({ slug: z.string().trim().min(1).max(64) }))
      .query(async ({ input }) => {
        const offer = await getPublishedOfferBySlug(input.slug);
        if (!offer) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Freebie nicht gefunden." });
        }
        return publicOfferPayload(offer);
      }),
    /** Resolve published Freebie by READY custom hostname (not shared hosts). */
    offerByHost: publicProcedure
      .input(z.object({ hostname: z.string().min(1).max(253) }))
      .query(async ({ input }) => {
        const hostname = normalizeHostname(input.hostname);
        if (
          !hostname ||
          isSharedFreebieHost(hostname, process.env.FREEBIE_SHARED_HOSTS)
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Kein Freebie für diesen Host hinterlegt.",
          });
        }
        const offerId = await getOfferIdByCustomHostname(hostname);
        if (!offerId) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              "Diese Domain ist noch nicht mit einem veröffentlichten Freebie verbunden.",
          });
        }
        const offer = await getOfferById(offerId);
        if (!offer || !offer.isPublished) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Das gebundene Freebie ist nicht veröffentlicht.",
          });
        }
        return {
          ...publicOfferPayload(offer),
          boundHostname: hostname,
        };
      }),
    capture: publicProcedure
      .input(
        z.object({
          slug: z.string().trim().min(1).max(64),
          email: z.string().trim().email().max(320),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const offer = await getPublishedOfferBySlug(input.slug);
        if (!offer) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Freebie nicht gefunden." });
        }
        if (!offer.mediaAssetId) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Für dieses Freebie ist noch keine Datei hinterlegt.",
          });
        }

        const { lead, doiToken, otp } = await createPendingLead({
          offer,
          email: input.email,
        });

        if (offer.confirmationMode === "doi" && doiToken) {
          const confirmUrl = `${resolvePublicAppBaseUrl(ctx.req)}/confirm?token=${encodeURIComponent(doiToken)}`;
          const mail = buildDoiMail({ offerTitle: offer.title, confirmUrl });
          await sendTransactionalMail({ to: lead.email, ...mail });
          return { mode: "doi" as const, leadId: lead.id };
        }

        if (offer.confirmationMode === "otp" && otp) {
          const mail = buildOtpMail({ offerTitle: offer.title, otp });
          await sendTransactionalMail({ to: lead.email, ...mail });
          return { mode: "otp" as const, leadId: lead.id };
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Bestätigungsmodus konnte nicht gestartet werden.",
        });
      }),
    confirmDoi: publicProcedure
      .input(z.object({ token: z.string().trim().min(16).max(200) }))
      .mutation(async ({ input }) => {
        const lead = await confirmLeadByDoiToken(input.token);
        if (!lead) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Link ungültig oder bereits verwendet.",
          });
        }
        const offer = await getOfferById(lead.offerId);
        if (!offer) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Freebie nicht gefunden." });
        }
        const downloadUrl = await resolveDownloadUrl(offer);
        if (!downloadUrl) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Datei nicht verfügbar.",
          });
        }
        await markLeadDelivered(lead.id);
        const mail = buildDeliveryMail({ offerTitle: offer.title, downloadUrl });
        await sendTransactionalMail({ to: lead.email, ...mail });
        return {
          downloadUrl,
          title: offer.title,
          metaTracking: {
            enabled: offer.metaTracking.enabled,
            pixelId: offer.metaTracking.pixelId,
            eventName: offer.metaTracking.eventName,
          },
        };
      }),
    confirmOtp: publicProcedure
      .input(
        z.object({
          leadId: z.string().uuid(),
          otp: z.string().trim().min(4).max(12),
        }),
      )
      .mutation(async ({ input }) => {
        const lead = await confirmLeadByOtp(input);
        if (!lead) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Code ungültig oder abgelaufen.",
          });
        }
        const offer = await getOfferById(lead.offerId);
        if (!offer) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Freebie nicht gefunden." });
        }
        const downloadUrl = await resolveDownloadUrl(offer);
        if (!downloadUrl) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Datei nicht verfügbar.",
          });
        }
        await markLeadDelivered(lead.id);
        const mail = buildDeliveryMail({ offerTitle: offer.title, downloadUrl });
        await sendTransactionalMail({ to: lead.email, ...mail });
        return {
          downloadUrl,
          title: offer.title,
          metaTracking: {
            enabled: offer.metaTracking.enabled,
            pixelId: offer.metaTracking.pixelId,
            eventName: offer.metaTracking.eventName,
          },
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
