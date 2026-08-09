import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function resolvePublicDir() {
  const candidates = [
    path.resolve(process.cwd(), "public"),
    path.resolve(process.cwd(), "dist", "public"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }

  return candidates[0];
}

function isApiPath(pathname: string) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function attachSpaFallback(app: Express) {
  const publicDir = resolvePublicDir();
  const indexPath = path.join(publicDir, "index.html");

  if (!fs.existsSync(indexPath)) {
    console.error(
      `[Frontend] Build fehlt: ${indexPath}. Bitte "pnpm build" / vercel-build ausführen.`,
    );
  }

  if (process.env.VERCEL) {
    return;
  }

  app.use(express.static(publicDir));

  app.get("*", (req, res, next) => {
    if (isApiPath(req.path)) {
      next();
      return;
    }
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
      return;
    }
    res
      .status(500)
      .type("text/plain")
      .send("Frontend-Build fehlt (public/index.html). Bitte pnpm build ausführen.");
  });
}
