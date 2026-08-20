import type { Request } from "express";

import { ENV } from "./_core/env";
import {
  isSharedFreebieHost,
  normalizeHostname,
} from "../shared/freebieHosts";

/** Prefer the visitor's host for DOI links on custom domains. */
export function resolvePublicAppBaseUrl(req: Request): string {
  const forwardedHost = req.headers["x-forwarded-host"];
  const hostHeader = Array.isArray(forwardedHost)
    ? forwardedHost[0]
    : forwardedHost || req.headers.host || "";
  const hostname = normalizeHostname(String(hostHeader).split(",")[0] ?? "");
  if (
    hostname &&
    !isSharedFreebieHost(hostname, process.env.FREEBIE_SHARED_HOSTS)
  ) {
    const forwardedProto = req.headers["x-forwarded-proto"];
    const protoRaw = Array.isArray(forwardedProto)
      ? forwardedProto[0]
      : forwardedProto;
    const proto =
      String(protoRaw || "").split(",")[0]?.trim() === "http" ? "http" : "https";
    return `${proto}://${hostname}`;
  }
  return ENV.publicAppUrl;
}
