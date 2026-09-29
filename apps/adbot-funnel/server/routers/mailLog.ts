import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { canViewMailLog, listMailLog } from "../mailLog";

export const mailLogRouter = router({
  access: adminProcedure.query(({ ctx }) => ({ canView: canViewMailLog(ctx.user) })),

  list: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(200) }).optional())
    .query(async ({ ctx, input }) => {
      if (!canViewMailLog(ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Das Versandprotokoll ist für dieses Konto nicht freigegeben." });
      }
      return listMailLog({ limit: input?.limit });
    }),
});
