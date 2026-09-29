import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { User } from "../../drizzle/schema";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import {
  findMemberLogin,
  MEMBER_PASSWORD_MIN_LENGTH,
  hashMemberPassword,
  isReservedMemberEmail,
} from "../_core/memberLogins";
import {
  MemberEmailTakenError,
  createMember,
  deleteMember,
  listMembersForOwner,
  setMemberCanPromote,
  setMemberPasswordHash,
  toMemberSummary,
} from "../funnelMembers";
import { getFunnelById, listFunnels } from "../funnelStore";
import { getTenantOwnerUserId } from "../_core/session";
import { EMPTY_ACCOUNT_PROFILE, getAccountProfile, saveAccountProfile, type FunnelAccountProfile } from "../funnelAccountProfiles";
import { deriveCompanyName, type AccountBranding } from "@shared/accountBranding";
import { resolveRequestFunnelHost } from "../resolveFunnelRequestHost";

const passwordSchema = z.string().min(MEMBER_PASSWORD_MIN_LENGTH, `Mindestens ${MEMBER_PASSWORD_MIN_LENGTH} Zeichen.`).max(200);

/** Nur der Konto-Inhaber (per Adbot angemeldet) verwaltet Zugänge, nicht die Mitglieder selbst. */
function requireAccountOwner(user: User): string {
  if (user.loginMethod !== "adbot-sso") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Zugänge verwaltet der Konto-Inhaber nach Anmeldung über Adbot.",
    });
  }
  return user.openId;
}

export type LoginBranding = { logoUrl: string; logoAlt: string };

/** Logo für das Login-Fenster: aus dem Funnel der Domain bzw. den Funnels des Kontos. */
async function loginBrandingForHost(hostname: string): Promise<LoginBranding | null> {
  const host = await resolveRequestFunnelHost(hostname);
  let funnelIds: string[] = [];
  if (host.kind === "funnel") {
    funnelIds = [host.funnelId];
  } else if (host.kind === "account") {
    funnelIds = await ownerFunnelIdsForBranding(host.ownerUserId);
  }
  return firstFunnelLogo(funnelIds);
}

/** Veröffentlichte Funnels zuerst, dann die zuletzt bearbeiteten. */
async function ownerFunnelIdsForBranding(ownerUserId: string): Promise<string[]> {
  const owned = await listFunnels({ ownerUserId });
  return [...owned]
    .sort((a, b) => Number(b.status === "published") - Number(a.status === "published") || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 10)
    .map(item => item.id);
}

async function firstFunnelLogo(funnelIds: string[]): Promise<LoginBranding | null> {
  for (const id of funnelIds) {
    const config = await getFunnelById(id);
    const logoUrl = config?.brand.logoUrl?.trim();
    if (config && logoUrl) return { logoUrl, logoAlt: config.brand.logoAlt || config.title };
  }
  return null;
}

/** Fehlt die Tabelle noch (Migration offen), bleibt das Dashboard beim abgeleiteten Namen. */
async function readProfileSafely(ownerUserId: string): Promise<FunnelAccountProfile> {
  try {
    return await getAccountProfile(ownerUserId);
  } catch (error) {
    console.warn("[dashboard] Firmenangaben nicht lesbar", error);
    return EMPTY_ACCOUNT_PROFILE;
  }
}

/** Firmenname + Logo für den Kopf des Kunden-Dashboards; Plattform-Admins behalten "Adbot Funnel". */
async function accountBrandingForUser(user: User): Promise<AccountBranding> {
  const ownerUserId = getTenantOwnerUserId(user);
  if (!ownerUserId) return { companyName: null, legalName: null, logoUrl: null, logoAlt: "" };
  const [profile, logo] = await Promise.all([
    readProfileSafely(ownerUserId),
    ownerFunnelIdsForBranding(ownerUserId).then(firstFunnelLogo),
  ]);
  return {
    companyName: deriveCompanyName({ ...profile, email: user.email, logoAlt: logo?.logoAlt }),
    legalName: profile.companyName || null,
    logoUrl: logo?.logoUrl ?? null,
    logoAlt: logo?.logoAlt ?? "",
  };
}

/**
 * Was die Oberfläche zeigen darf. Konto-Inhaber und Plattform-Admin sehen die Bewerben-Buttons immer;
 * ein Funnel-Zugang nur, wenn der Konto-Inhaber es unter „Konto“ eingeschaltet hat.
 */
async function permissionsFor(user: User) {
  const canManageMembers = user.loginMethod === "adbot-sso";
  if (user.loginMethod !== "member") return { canManageMembers, canPromote: true };
  const member = user.email ? await findMemberLogin(user.email) : null;
  return { canManageMembers, canPromote: member?.canPromote === true };
}

export const membersRouter = router({
  permissions: adminProcedure.query(({ ctx }) => permissionsFor(ctx.user)),

  loginBranding: publicProcedure
    .input(z.object({ hostname: z.string().min(1).max(253) }))
    .query(async ({ input }) => {
      try {
        return await loginBrandingForHost(input.hostname);
      } catch (error) {
        console.warn("[member-login] Login-Logo nicht lesbar", error);
        return null;
      }
    }),

  accountBranding: adminProcedure.query(async ({ ctx }): Promise<AccountBranding> => {
    try {
      return await accountBrandingForUser(ctx.user);
    } catch (error) {
      console.warn("[dashboard] Konto-Branding nicht lesbar", error);
      return { companyName: deriveCompanyName({ email: ctx.user.email }), legalName: null, logoUrl: null, logoAlt: "" };
    }
  }),

  accountProfile: adminProcedure.query(async ({ ctx }): Promise<FunnelAccountProfile> => {
    return getAccountProfile(requireAccountOwner(ctx.user));
  }),

  saveAccountProfile: adminProcedure
    .input(z.object({
      companyName: z.string().trim().max(200, "Höchstens 200 Zeichen."),
      displayName: z.string().trim().max(80, "Höchstens 80 Zeichen."),
    }))
    .mutation(async ({ input, ctx }) => {
      return saveAccountProfile(requireAccountOwner(ctx.user), input);
    }),

  list: adminProcedure.query(async ({ ctx }) => {
    const ownerUserId = requireAccountOwner(ctx.user);
    const members = await listMembersForOwner(ownerUserId);
    return members.map(toMemberSummary);
  }),

  create: adminProcedure
    .input(z.object({
      email: z.string().trim().email("Bitte eine gültige E-Mail-Adresse eingeben.").max(320),
      name: z.string().trim().max(120).default(""),
      password: passwordSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const ownerUserId = requireAccountOwner(ctx.user);
      const email = input.email.toLowerCase();
      if (isReservedMemberEmail(email) || email === ctx.user.email?.toLowerCase()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Diese E-Mail-Adresse kann kein zusätzlicher Zugang sein." });
      }
      try {
        const member = await createMember({
          ownerUserId,
          email,
          name: input.name,
          passwordHash: hashMemberPassword(input.password),
          createdByEmail: ctx.user.email ?? "",
        });
        return toMemberSummary(member);
      } catch (error) {
        if (error instanceof MemberEmailTakenError) {
          throw new TRPCError({ code: "CONFLICT", message: error.message });
        }
        throw error;
      }
    }),

  resetPassword: adminProcedure
    .input(z.object({ id: z.string().uuid(), password: passwordSchema }))
    .mutation(async ({ ctx, input }) => {
      const ownerUserId = requireAccountOwner(ctx.user);
      const member = await setMemberPasswordHash({
        ownerUserId,
        memberId: input.id,
        passwordHash: hashMemberPassword(input.password),
      });
      if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Zugang nicht gefunden." });
      return toMemberSummary(member);
    }),

  setCanPromote: adminProcedure
    .input(z.object({ id: z.string().uuid(), canPromote: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const ownerUserId = requireAccountOwner(ctx.user);
      const member = await setMemberCanPromote({ ownerUserId, memberId: input.id, canPromote: input.canPromote });
      if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Zugang nicht gefunden." });
      return toMemberSummary(member);
    }),

  remove: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const ownerUserId = requireAccountOwner(ctx.user);
      const removed = await deleteMember({ ownerUserId, memberId: input.id });
      if (!removed) throw new TRPCError({ code: "NOT_FOUND", message: "Zugang nicht gefunden." });
      return { success: true as const };
    }),
});
