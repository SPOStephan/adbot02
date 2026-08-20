import type { Express, Request, Response } from "express";
import { ENV } from "./env";
import { verifyFunnelMetaPixelSyncToken } from "./adbotMetaSync";
import { softApplyMetaPixel } from "../../shared/metaPixelSoftApply";
import { getFunnelById, listFunnels, saveFunnel } from "../funnelStore";

export type PortalMetaSyncFunnelResult = {
  funnelId: string;
  slug: string;
  action: "set_and_enable" | "ensure_enabled" | "skip";
};

export async function softApplyPixelToOwnerFunnels(input: {
  ownerUserId: string;
  pixelId: string;
  eventName: string;
}): Promise<PortalMetaSyncFunnelResult[]> {
  const funnels = await listFunnels({ ownerUserId: input.ownerUserId });
  const results: PortalMetaSyncFunnelResult[] = [];

  for (const summary of funnels) {
    const config = await getFunnelById(summary.id);
    if (!config) continue;

    const applied = softApplyMetaPixel(config.metaTracking, input.pixelId, {
      eventName: input.eventName,
    });

    if (applied.action !== "skip") {
      await saveFunnel({
        ...config,
        metaTracking: applied.next,
      });
    }

    results.push({
      funnelId: summary.id,
      slug: summary.slug,
      action: applied.action,
    });
  }

  return results;
}

export function registerPortalMetaSyncRoute(app: Express) {
  app.post(
    "/api/internal/portal-meta-sync",
    async (req: Request, res: Response) => {
      const secret = ENV.funnelSsoSecret;
      if (!secret || secret.length < 32) {
        res.status(503).json({
          ok: false,
          message: "FUNNEL_SSO_SECRET fehlt oder ist zu kurz.",
        });
        return;
      }

      const token =
        typeof req.body?.token === "string"
          ? req.body.token
          : typeof req.headers.authorization === "string" &&
              req.headers.authorization.startsWith("Bearer ")
            ? req.headers.authorization.slice("Bearer ".length).trim()
            : "";

      if (!token) {
        res.status(401).json({ ok: false, message: "Sync-Token fehlt." });
        return;
      }

      const payload = verifyFunnelMetaPixelSyncToken(token, secret);
      if (!payload) {
        res.status(401).json({
          ok: false,
          message: "Sync-Token ungültig oder abgelaufen.",
        });
        return;
      }

      try {
        const results = await softApplyPixelToOwnerFunnels({
          ownerUserId: payload.sub,
          pixelId: payload.pixelId,
          eventName: payload.eventName,
        });
        res.status(200).json({
          ok: true,
          pixelId: payload.pixelId,
          eventName: payload.eventName,
          funnels: results,
        });
      } catch (error) {
        console.error("[portal-meta-sync] Soft-Apply fehlgeschlagen", error);
        res.status(500).json({
          ok: false,
          message: "Pixel konnte nicht in die Funnel übernommen werden.",
        });
      }
    },
  );
}
