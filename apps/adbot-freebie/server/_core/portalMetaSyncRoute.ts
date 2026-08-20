import type { Express, Request, Response } from "express";
import { ENV } from "./env";
import { verifyFreebieMetaPixelSyncToken } from "./adbotMetaSync";
import { softApplyMetaPixel } from "../../shared/metaPixelSoftApply";
import { getOfferById, listOffers, upsertOffer } from "../freebieStore";

export type PortalMetaSyncOfferResult = {
  offerId: string;
  slug: string;
  action: "set_and_enable" | "ensure_enabled" | "skip";
};

export async function softApplyPixelToOwnerOffers(input: {
  ownerUserId: string;
  pixelId: string;
  eventName: string;
}): Promise<PortalMetaSyncOfferResult[]> {
  const offers = await listOffers(input.ownerUserId);
  const results: PortalMetaSyncOfferResult[] = [];

  for (const summary of offers) {
    const offer = await getOfferById(summary.id);
    if (!offer) continue;

    const applied = softApplyMetaPixel(offer.metaTracking, input.pixelId, {
      eventName: input.eventName,
    });

    if (applied.action !== "skip") {
      await upsertOffer({
        id: offer.id,
        ownerUserId: offer.ownerUserId,
        ownerEmail: offer.ownerEmail,
        title: offer.title,
        description: offer.description,
        confirmationMode: offer.confirmationMode,
        slug: offer.slug,
        mediaAssetId: offer.mediaAssetId,
        isPublished: offer.isPublished,
        metaTracking: applied.next,
      });
    }

    results.push({
      offerId: offer.id,
      slug: offer.slug,
      action: applied.action,
    });
  }

  return results;
}

export function registerPortalMetaSyncRoute(app: Express) {
  app.post(
    "/api/internal/portal-meta-sync",
    async (req: Request, res: Response) => {
      const secret = ENV.freebieSsoSecret;
      if (!secret || secret.length < 32) {
        res.status(503).json({
          ok: false,
          message: "FREEBIE_SSO_SECRET fehlt oder ist zu kurz.",
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

      const payload = verifyFreebieMetaPixelSyncToken(token, secret);
      if (!payload) {
        res.status(401).json({
          ok: false,
          message: "Sync-Token ungültig oder abgelaufen.",
        });
        return;
      }

      try {
        const results = await softApplyPixelToOwnerOffers({
          ownerUserId: payload.sub,
          pixelId: payload.pixelId,
          eventName: payload.eventName,
        });
        res.status(200).json({
          ok: true,
          pixelId: payload.pixelId,
          eventName: payload.eventName,
          offers: results,
        });
      } catch (error) {
        console.error("[portal-meta-sync] Soft-Apply fehlgeschlagen", error);
        res.status(500).json({
          ok: false,
          message: "Pixel konnte nicht in die Freebies übernommen werden.",
        });
      }
    },
  );
}
