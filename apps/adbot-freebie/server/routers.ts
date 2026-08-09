import { z } from "zod";
import { COOKIE_NAME, ONE_YEAR_MS } from "../shared/const";
import { TRPCError } from "@trpc/server";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
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

const confirmationModeSchema = z.enum(["doi", "otp"]);

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
  }),
  public: router({
    offer: publicProcedure
      .input(z.object({ slug: z.string().trim().min(1).max(64) }))
      .query(async ({ input }) => {
        const offer = await getPublishedOfferBySlug(input.slug);
        if (!offer) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Freebie nicht gefunden." });
        }
        return {
          slug: offer.slug,
          title: offer.title,
          description: offer.description,
          confirmationMode: offer.confirmationMode,
          hasFile: Boolean(offer.mediaAssetId),
        };
      }),
    capture: publicProcedure
      .input(
        z.object({
          slug: z.string().trim().min(1).max(64),
          email: z.string().trim().email().max(320),
        }),
      )
      .mutation(async ({ input }) => {
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
          const confirmUrl = `${ENV.publicAppUrl}/confirm?token=${encodeURIComponent(doiToken)}`;
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
        return { downloadUrl, title: offer.title };
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
        return { downloadUrl, title: offer.title };
      }),
  }),
});

export type AppRouter = typeof appRouter;
