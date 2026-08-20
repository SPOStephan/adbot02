import express, { type Express } from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { attachSpaFallback } from "./spaFallback";
import { registerAdbotSsoRoute } from "./adbotSsoRoute";
import { registerPortalMetaSyncRoute } from "./portalMetaSyncRoute";

export type CreateAppOptions = {
  serveFrontend?: boolean;
};

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  app.use(express.json({ limit: "20mb" }));
  app.use(express.urlencoded({ limit: "20mb", extended: true }));
  app.get("/api/health", (_req, res) => {
    res.status(200).json({ ok: true, service: "adbot-freebie" });
  });
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });
  registerAdbotSsoRoute(app);
  registerPortalMetaSyncRoute(app);
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
