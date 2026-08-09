import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html",
      );

      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function resolvePublicDir() {
  const candidates = [
    path.resolve(process.cwd(), "public"),
    path.resolve(process.cwd(), "dist", "public"),
    path.resolve(import.meta.dirname, "../..", "dist", "public"),
    path.resolve(import.meta.dirname, "public"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }

  return candidates[0];
}

/** SPA fallback + local static serving. On Vercel, CDN serves /public; express.static is ignored. */
export function attachSpaFallback(app: Express) {
  const publicDir = resolvePublicDir();
  const indexPath = path.join(publicDir, "index.html");

  if (!fs.existsSync(indexPath)) {
    console.error(
      `[Frontend] Build fehlt: ${indexPath}. Bitte "pnpm build" ausführen.`,
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
    // On Vercel the CDN serves /index.html from public/; keep the SPA bootable
    // even if the file is not inside the function bundle.
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

/** @deprecated use attachSpaFallback */
export function serveStatic(app: Express) {
  attachSpaFallback(app);
}
