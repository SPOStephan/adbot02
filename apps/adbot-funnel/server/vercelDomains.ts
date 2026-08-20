/**
 * Attach/verify/remove customer hostnames on this Vercel project via REST API.
 * Customer only sets DNS (CNAME); no dashboard access needed.
 */

export type VercelDomainVerification = {
  type: string;
  domain: string;
  value: string;
  reason: string;
};

export type VercelDomainResult = {
  ok: boolean;
  configured: boolean;
  alreadyAttached: boolean;
  verified: boolean;
  message: string;
  verification: VercelDomainVerification[];
};

function readEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function getVercelDomainApiConfig(): {
  token: string;
  projectId: string;
  teamId: string | null;
} | null {
  const token =
    readEnv("ADBOT_VERCEL_API_TOKEN") || readEnv("VERCEL_API_TOKEN");
  const projectId = readEnv("VERCEL_PROJECT_ID");
  if (!token || !projectId) return null;
  const teamId = readEnv("VERCEL_TEAM_ID") || null;
  return { token, projectId, teamId };
}

export function isVercelDomainApiConfigured(): boolean {
  return getVercelDomainApiConfig() !== null;
}

function teamQuery(teamId: string | null): string {
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
}

async function vercelFetch(
  path: string,
  init: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const config = getVercelDomainApiConfig();
  if (!config) {
    return {
      status: 0,
      body: { error: { message: "Vercel-Domain-API nicht konfiguriert." } },
    };
  }
  const response = await fetch(`https://api.vercel.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  return { status: response.status, body };
}

function errorMessage(body: Record<string, unknown>, fallback: string): string {
  const error = body.error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  if (typeof body.message === "string" && body.message.trim()) {
    return body.message.trim();
  }
  return fallback;
}

function mapVerification(body: Record<string, unknown>): VercelDomainVerification[] {
  const raw = body.verification;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    return [
      {
        type: String(row.type ?? ""),
        domain: String(row.domain ?? ""),
        value: String(row.value ?? ""),
        reason: String(row.reason ?? ""),
      },
    ];
  });
}

/**
 * Idempotent: adds hostname to this Vercel project (SSL + routing).
 * Treats "already exists" as success.
 */
export async function attachDomainToVercelProject(
  hostname: string,
): Promise<VercelDomainResult> {
  const config = getVercelDomainApiConfig();
  if (!config) {
    return {
      ok: false,
      configured: false,
      alreadyAttached: false,
      verified: false,
      message:
        "Vercel-Domain-API nicht konfiguriert (ADBOT_VERCEL_API_TOKEN + VERCEL_PROJECT_ID).",
      verification: [],
    };
  }

  const path = `/v10/projects/${encodeURIComponent(config.projectId)}/domains${teamQuery(config.teamId)}`;
  const { status, body } = await vercelFetch(path, {
    method: "POST",
    body: JSON.stringify({ name: hostname }),
  });

  // Already on this project
  if (
    status === 409 ||
    status === 400 &&
      /already|exists|taken/i.test(errorMessage(body, ""))
  ) {
    return {
      ok: true,
      configured: true,
      alreadyAttached: true,
      verified: true,
      message: `Domain ${hostname} ist bereits am Vercel-Projekt hinterlegt.`,
      verification: [],
    };
  }

  if (status < 200 || status >= 300) {
    return {
      ok: false,
      configured: true,
      alreadyAttached: false,
      verified: false,
      message: errorMessage(
        body,
        `Vercel konnte die Domain ${hostname} nicht hinzufügen.`,
      ),
      verification: mapVerification(body),
    };
  }

  const verified = body.verified === true;
  return {
    ok: true,
    configured: true,
    alreadyAttached: false,
    verified,
    message: verified
      ? `Domain ${hostname} am Vercel-Projekt hinterlegt (SSL aktiv).`
      : `Domain ${hostname} am Vercel-Projekt hinterlegt — Verifikation folgt nach DNS.`,
    verification: mapVerification(body),
  };
}

/** Ask Vercel to re-check ownership/DNS for the project domain. */
export async function verifyDomainOnVercelProject(
  hostname: string,
): Promise<VercelDomainResult> {
  const config = getVercelDomainApiConfig();
  if (!config) {
    return {
      ok: false,
      configured: false,
      alreadyAttached: false,
      verified: false,
      message:
        "Vercel-Domain-API nicht konfiguriert (ADBOT_VERCEL_API_TOKEN + VERCEL_PROJECT_ID).",
      verification: [],
    };
  }

  const path = `/v9/projects/${encodeURIComponent(config.projectId)}/domains/${encodeURIComponent(hostname)}/verify${teamQuery(config.teamId)}`;
  const { status, body } = await vercelFetch(path, { method: "POST" });

  if (status < 200 || status >= 300) {
    // Not yet attached — try attach then verify once.
    if (status === 404) {
      const attached = await attachDomainToVercelProject(hostname);
      if (!attached.ok) return attached;
      const retry = await vercelFetch(path, { method: "POST" });
      if (retry.status >= 200 && retry.status < 300) {
        return {
          ok: true,
          configured: true,
          alreadyAttached: attached.alreadyAttached,
          verified: retry.body.verified === true,
          message:
            retry.body.verified === true
              ? `Vercel-Verifikation für ${hostname} erfolgreich.`
              : `Vercel prüft ${hostname} noch (DNS/SSL).`,
          verification: mapVerification(retry.body),
        };
      }
      return {
        ok: false,
        configured: true,
        alreadyAttached: true,
        verified: false,
        message: errorMessage(
          retry.body,
          `Vercel-Verifikation für ${hostname} fehlgeschlagen.`,
        ),
        verification: mapVerification(retry.body),
      };
    }
    return {
      ok: false,
      configured: true,
      alreadyAttached: false,
      verified: false,
      message: errorMessage(
        body,
        `Vercel-Verifikation für ${hostname} fehlgeschlagen.`,
      ),
      verification: mapVerification(body),
    };
  }

  return {
    ok: true,
    configured: true,
    alreadyAttached: true,
    verified: body.verified === true,
    message:
      body.verified === true
        ? `Vercel-Verifikation für ${hostname} erfolgreich.`
        : `Vercel prüft ${hostname} noch (DNS/SSL).`,
    verification: mapVerification(body),
  };
}

/** Best-effort remove; ignores missing domain. */
export async function removeDomainFromVercelProject(
  hostname: string,
): Promise<VercelDomainResult> {
  const config = getVercelDomainApiConfig();
  if (!config) {
    return {
      ok: true,
      configured: false,
      alreadyAttached: false,
      verified: false,
      message: "Vercel-Domain-API nicht konfiguriert — Remove übersprungen.",
      verification: [],
    };
  }

  const path = `/v9/projects/${encodeURIComponent(config.projectId)}/domains/${encodeURIComponent(hostname)}${teamQuery(config.teamId)}`;
  const { status, body } = await vercelFetch(path, { method: "DELETE" });

  if (status === 404 || (status >= 200 && status < 300)) {
    return {
      ok: true,
      configured: true,
      alreadyAttached: false,
      verified: false,
      message: `Domain ${hostname} vom Vercel-Projekt entfernt.`,
      verification: [],
    };
  }

  return {
    ok: false,
    configured: true,
    alreadyAttached: true,
    verified: false,
    message: errorMessage(
      body,
      `Domain ${hostname} konnte nicht von Vercel entfernt werden.`,
    ),
    verification: [],
  };
}
