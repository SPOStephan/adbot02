import "server-only";

import { createAppSecretProof } from "./crypto";

export const META_GRAPH_VERSION = "v25.0";

const META_DIALOG_ORIGIN = "https://www.facebook.com";
const META_GRAPH_ORIGIN = "https://graph.facebook.com";

export type MetaAccessToken = {
  accessToken: string;
  expiresInSeconds: number | null;
  tokenType: string | null;
};

export type MetaIdentity = {
  id: string;
};

type MetaErrorBody = {
  error?: {
    code?: number;
    type?: string;
    error_subcode?: number;
  };
};

export class MetaGraphError extends Error {
  readonly status: number;
  readonly code: number | null;
  readonly subcode: number | null;

  constructor(status: number, body: MetaErrorBody) {
    super("Meta Graph API request failed");
    this.name = "MetaGraphError";
    this.status = status;
    this.code = body.error?.code ?? null;
    this.subcode = body.error?.error_subcode ?? null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchMetaJson(
  url: URL,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...headers,
    },
  });
  const body = await readJson(response);

  if (!response.ok) {
    throw new MetaGraphError(
      response.status,
      isRecord(body) ? (body as MetaErrorBody) : {},
    );
  }

  return body;
}

export function createMetaLoginUrl(input: {
  appId: string;
  configId: string;
  redirectUri: string;
  state: string;
}): URL {
  const url = new URL(`/${META_GRAPH_VERSION}/dialog/oauth`, META_DIALOG_ORIGIN);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("config_id", input.configId);

  return url;
}

export async function exchangeCodeForAccessToken(input: {
  appId: string;
  appSecret: string;
  code: string;
  redirectUri: string;
}): Promise<MetaAccessToken> {
  const url = new URL(
    `/${META_GRAPH_VERSION}/oauth/access_token`,
    META_GRAPH_ORIGIN,
  );
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("client_secret", input.appSecret);
  url.searchParams.set("code", input.code);
  url.searchParams.set("redirect_uri", input.redirectUri);

  const body = await fetchMetaJson(url);

  if (!isRecord(body) || typeof body.access_token !== "string") {
    throw new MetaGraphError(502, {});
  }

  return {
    accessToken: body.access_token,
    expiresInSeconds:
      typeof body.expires_in === "number" ? body.expires_in : null,
    tokenType: typeof body.token_type === "string" ? body.token_type : null,
  };
}

export async function getMetaIdentity(input: {
  accessToken: string;
  appSecret: string;
}): Promise<MetaIdentity> {
  const url = new URL(`/${META_GRAPH_VERSION}/me`, META_GRAPH_ORIGIN);
  url.searchParams.set("fields", "id");
  url.searchParams.set(
    "appsecret_proof",
    createAppSecretProof(input.accessToken, input.appSecret),
  );

  const body = await fetchMetaJson(url, {
    Authorization: `Bearer ${input.accessToken}`,
  });

  if (!isRecord(body) || typeof body.id !== "string") {
    throw new MetaGraphError(502, {});
  }

  return {
    id: body.id,
  };
}
