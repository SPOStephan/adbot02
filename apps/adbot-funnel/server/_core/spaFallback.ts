import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function resolvePublicDir() {
  const candidates = [
    path.resolve(process.cwd(), "public"),
    path.resolve(process.cwd(), "dist", "public"),
    path.resolve(import.meta.dirname, "../..", "dist", "public"),
    path.resolve(import.meta.dirname, "../..", "public"),
    path.resolve(import.meta.dirname, "public"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }

  return candidates[0];
}

/** SPA fallback + local static serving. No Vite imports (safe for Vercel functions). */
export function attachSpaFallback(app: Express) {
  const publicDir = resolvePublicDir();
  const indexPath = path.join(publicDir, "index.html");

  if (!fs.existsSync(indexPath)) {
    console.error(
      `[Frontend] Build fehlt: ${indexPath}. Bitte "pnpm build" / vercel-build ausführen.`,
    );
  }

  if (!process.env.VERCEL) {
    app.use(express.static(publicDir));
  }

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
      return;
    }
    if (process.env.VERCEL) {
      res.redirect(302, "/index.html");
      return;
    }
    res
      .status(500)
      .type("text/plain")
      .send("Frontend-Build fehlt (public/index.html). Bitte pnpm build ausführen.");
  });
}
