import type { Express, Request, Response } from "express";
import { isPublicFunnelStorageKey } from "../publicFunnelStorage";
import { storageGetSignedUrl } from "../storage";
import { authenticateRequest } from "./session";

async function handleStorageDownload(req: Request, res: Response, key: string) {
  try {
    if (!key || key.includes("..")) {
      res.status(400).json({ error: "Invalid storage key" });
      return;
    }

    if (!isPublicFunnelStorageKey(key)) {
      const user = await authenticateRequest(req);
      if (!user || user.role !== "admin") {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    }

    const signedUrl = await storageGetSignedUrl(key, isPublicFunnelStorageKey(key) ? 3600 : 300);
    if (isPublicFunnelStorageKey(key)) {
      res.setHeader("Cache-Control", "public, max-age=300");
    }
    res.redirect(302, signedUrl);
  } catch (error) {
    console.error("[Storage] Signed URL proxy failed", error);
    res.status(500).json({ error: "Storage unavailable" });
  }
}

export function registerStorageProxy(app: Express) {
  app.get("/api/storage/*", async (req, res) => {
    const key = decodeURIComponent(req.path.replace(/^\/api\/storage\//, ""));
    await handleStorageDownload(req, res, key);
  });

  // Legacy path from Manus-era stored resume URLs
  app.get("/manus-storage/*", async (req, res) => {
    const key = decodeURIComponent(req.path.replace(/^\/manus-storage\//, ""));
    await handleStorageDownload(req, res, key);
  });
}
