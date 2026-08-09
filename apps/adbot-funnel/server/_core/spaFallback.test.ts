import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { attachSpaFallback } from "./spaFallback";

function layerCount(app: express.Express) {
  const router = (app as unknown as { _router?: { stack?: unknown[] } })._router;
  return router?.stack?.length ?? 0;
}

describe("attachSpaFallback", () => {
  afterEach(() => {
    delete process.env.VERCEL;
  });

  it("hängt unter VERCEL keine Express-SPA-Middleware an (kein Redirect-Loop)", () => {
    process.env.VERCEL = "1";
    const app = express();
    app.get("/probe", (_req, res) => {
      res.end("ok");
    });
    const before = layerCount(app);
    attachSpaFallback(app);
    expect(layerCount(app)).toBe(before);
  });

  it("hängt lokal Static + Catch-all an", () => {
    const app = express();
    app.get("/probe", (_req, res) => {
      res.end("ok");
    });
    const before = layerCount(app);
    attachSpaFallback(app);
    expect(layerCount(app)).toBeGreaterThan(before);
  });
});
