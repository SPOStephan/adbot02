import { z } from "zod";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import {
  buildAdminUser,
  createSessionToken,
  verifyAdminPassword,
} from "./_core/session";
import { publicProcedure, router } from "./_core/trpc";
import { funnelRouter } from "./routers/funnel";

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

        return { success: true as const, user };
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  funnel: funnelRouter,
});

export type AppRouter = typeof appRouter;
