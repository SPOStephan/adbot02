import type { Express, Request, Response } from "express";
import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const";
import { ENV } from "./env";
import { getSessionCookieOptions } from "./cookies";
import {
  buildAdbotSsoRedirectError,
  verifyAdbotSsoToken,
} from "./adbotSso";
import { buildTenantUser, createSessionToken } from "./session";

export function registerAdbotSsoRoute(app: Express) {
  app.get("/api/auth/adbot-sso", async (req: Request, res: Response) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) {
      res.redirect(302, buildAdbotSsoRedirectError("Token fehlt"));
      return;
    }

    const secret = ENV.funnelSsoSecret;
    if (!secret || secret.length < 32) {
      console.error("[adbot-sso] FUNNEL_SSO_SECRET fehlt oder ist zu kurz");
      res.redirect(302, buildAdbotSsoRedirectError("SSO nicht konfiguriert"));
      return;
    }

    if (!ENV.cookieSecret || ENV.cookieSecret.length < 32) {
      console.error("[adbot-sso] JWT_SECRET fehlt oder ist zu kurz");
      res.redirect(302, buildAdbotSsoRedirectError("Session nicht konfiguriert"));
      return;
    }

    const payload = verifyAdbotSsoToken(token, secret);
    if (!payload) {
      res.redirect(302, buildAdbotSsoRedirectError("Token ungültig oder abgelaufen"));
      return;
    }

    try {
      const user = buildTenantUser(payload.sub, payload.email, payload.name);
      const sessionToken = await createSessionToken(user);
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });
      res.redirect(302, "/admin");
    } catch (error) {
      console.error("[adbot-sso] Session konnte nicht erzeugt werden", error);
      res.redirect(302, buildAdbotSsoRedirectError("Session fehlgeschlagen"));
    }
  });
}
