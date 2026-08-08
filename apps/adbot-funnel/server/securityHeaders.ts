import type { NextFunction, Request, Response } from "express";
import { getFunnel, getOrCreateDefaultFunnel } from "./funnelStore";

export function buildFrameAncestorsPolicy(origins: string[]): string {
  const normalized = origins.flatMap(value => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:" ? [url.origin] : [];
    } catch {
      return [];
    }
  });
  const unique = Array.from(new Set(normalized));
  return `frame-ancestors 'self'${unique.length ? ` ${unique.join(" ")}` : ""}`;
}

export async function funnelSecurityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  const match = req.path.match(/^\/f\/([^/]+)\/?$/);
  if (!match || req.method !== "GET") return next();

  try {
    const slug = decodeURIComponent(match[1]!);
    const config = (await getFunnel(slug)) ?? (slug === "karriere" ? await getOrCreateDefaultFunnel() : null);
    res.setHeader("Content-Security-Policy", buildFrameAncestorsPolicy(config?.allowedEmbedOrigins ?? []));
  } catch (error) {
    console.error("[Security] Einbettungsregeln konnten nicht geladen werden", error);
    res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
  }
  return next();
}
