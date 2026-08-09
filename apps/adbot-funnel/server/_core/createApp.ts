import express, { type Express } from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { funnelSecurityHeaders } from "../securityHeaders";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { registerStorageProxy } from "./storageProxy";
import { attachSpaFallback } from "./spaFallback";

export type CreateAppOptions = {
  /** When false, skip static/SPA fallback (dev uses Vite middleware instead). */
  serveFrontend?: boolean;
};

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/health", (_req, res) => {
    res.status(200).json({ ok: true, service: "adbot-funnel" });
  });
  app.use(funnelSecurityHeaders);
  registerStorageProxy(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  if (options.serveFrontend !== false) {
    attachSpaFallback(app);
  }

  return app;
}
