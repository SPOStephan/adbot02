import "server-only";

import type { HttpCreativeAssetProviderConfig } from "./http-provider";
import type { OpenRouterCreativeAssetProviderConfig } from "./providers/openrouter";

export type CreativeAssetHttpRuntimeConfig = {
  kind: "http";
  provider: HttpCreativeAssetProviderConfig;
  storageBucket: string;
};

export type CreativeAssetOpenRouterRuntimeConfig = {
  kind: "openrouter";
  provider: OpenRouterCreativeAssetProviderConfig;
  storageBucket: string;
};

export type CreativeAssetRuntimeConfig =
  | CreativeAssetHttpRuntimeConfig
  | CreativeAssetOpenRouterRuntimeConfig;

const HTTP_ENV_NAMES = [
  "CREATIVE_ASSET_PROVIDER_ENDPOINT",
  "CREATIVE_ASSET_PROVIDER_API_KEY",
  "CREATIVE_ASSET_PROVIDER_ASSET_HOSTS",
] as const;

const OPENROUTER_REQUIRED_ENV_NAMES = [
  "CREATIVE_ASSET_OPENROUTER_MODEL_ALLOWLIST",
] as const;

function normalized(value: string | undefined): string | null {
  const result = value?.trim();
  return result ? result : null;
}

function parseTimeout(
  value: string | undefined,
  envName: string,
): number | undefined {
  const input = normalized(value);
  if (!input) {
    return undefined;
  }
  const milliseconds = Number(input);
  if (!Number.isInteger(milliseconds) || milliseconds < 5_000 || milliseconds > 120_000) {
    throw new Error(`${envName} muss zwischen 5000 und 120000 liegen.`);
  }
  return milliseconds;
}

function parseHosts(value: string, envName: string): string[] {
  const hosts = value
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (hosts.length === 0 || hosts.length > 20) {
    throw new Error(`${envName} muss 1 bis 20 Hostnamen enthalten.`);
  }
  for (const host of hosts) {
    if (
      host.includes("://") ||
      host.includes("/") ||
      host.includes("@") ||
      host.includes("*") ||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)
    ) {
      throw new Error(`${envName} enthält einen ungültigen Hostnamen.`);
    }
  }
  return [...new Set(hosts)];
}

function parseAllowlist(value: string): string[] {
  const models = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (models.length === 0 || models.length > 64) {
    throw new Error(
      "CREATIVE_ASSET_OPENROUTER_MODEL_ALLOWLIST muss 1 bis 64 Modelle enthalten.",
    );
  }
  for (const model of models) {
    if (model.length > 160) {
      throw new Error(
        "CREATIVE_ASSET_OPENROUTER_MODEL_ALLOWLIST enthält ein zu langes Modell.",
      );
    }
  }
  return [...new Set(models)];
}

function parseBucket(value: string | undefined): string {
  const bucket = normalized(value) ?? "creative-assets";
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(bucket)) {
    throw new Error("CREATIVE_ASSET_STORAGE_BUCKET ist ungültig.");
  }
  return bucket;
}

function parseProviderKey(value: string | undefined): string | null {
  const key = normalized(value);
  if (!key) {
    return null;
  }
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(key)) {
    throw new Error("CREATIVE_ASSET_PROVIDER_KEY ist ungültig.");
  }
  return key;
}

function parseHttpsBaseUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} ist keine gültige URL.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new Error(`${name} muss eine credential-freie HTTPS-URL sein.`);
  }
  return url.toString().replace(/\/+$/, "");
}

function resolveOpenRouterApiKey(): string | null {
  return (
    normalized(process.env.CREATIVE_ASSET_OPENROUTER_API_KEY) ??
    normalized(process.env.OPENROUTER_API_KEY)
  );
}

export function getCreativeAssetStorageBucket(): string {
  return parseBucket(process.env.CREATIVE_ASSET_STORAGE_BUCKET);
}

export function getCreativeAssetProviderKeyFromEnv(): string | null {
  return parseProviderKey(process.env.CREATIVE_ASSET_PROVIDER_KEY);
}

export function isOpenRouterCreativeAssetProviderKey(key: string): boolean {
  return key === "openrouter";
}

export function hasCreativeAssetProviderConfig(): boolean {
  const key = getCreativeAssetProviderKeyFromEnv();
  if (!key) {
    return false;
  }
  if (isOpenRouterCreativeAssetProviderKey(key)) {
    return (
      Boolean(resolveOpenRouterApiKey()) &&
      OPENROUTER_REQUIRED_ENV_NAMES.every((name) =>
        normalized(process.env[name]),
      )
    );
  }
  return HTTP_ENV_NAMES.every((name) => normalized(process.env[name]));
}

function getHttpRuntimeConfig(key: string): CreativeAssetHttpRuntimeConfig {
  const values = Object.fromEntries(
    HTTP_ENV_NAMES.map((name) => [name, normalized(process.env[name])]),
  ) as Record<(typeof HTTP_ENV_NAMES)[number], string | null>;

  const configuredCount = Object.values(values).filter(Boolean).length;
  if (configuredCount !== HTTP_ENV_NAMES.length) {
    throw new Error(
      configuredCount === 0
        ? "Creative-Asset-HTTP-Provider ist nicht konfiguriert."
        : "Creative-Asset-HTTP-Provider ist nur teilweise konfiguriert.",
    );
  }

  return {
    kind: "http",
    provider: {
      key,
      endpoint: values.CREATIVE_ASSET_PROVIDER_ENDPOINT as string,
      apiKey: values.CREATIVE_ASSET_PROVIDER_API_KEY as string,
      allowedAssetHosts: parseHosts(
        values.CREATIVE_ASSET_PROVIDER_ASSET_HOSTS as string,
        "CREATIVE_ASSET_PROVIDER_ASSET_HOSTS",
      ),
      timeoutMs: parseTimeout(
        process.env.CREATIVE_ASSET_PROVIDER_TIMEOUT_MS,
        "CREATIVE_ASSET_PROVIDER_TIMEOUT_MS",
      ),
    },
    storageBucket: getCreativeAssetStorageBucket(),
  };
}

function getOpenRouterRuntimeConfig(): CreativeAssetOpenRouterRuntimeConfig {
  const apiKey = resolveOpenRouterApiKey();
  const allowlistRaw = normalized(
    process.env.CREATIVE_ASSET_OPENROUTER_MODEL_ALLOWLIST,
  );
  if (!apiKey || !allowlistRaw) {
    const partial = Boolean(apiKey) !== Boolean(allowlistRaw);
    throw new Error(
      partial
        ? "Creative-Asset-OpenRouter-Provider ist nur teilweise konfiguriert."
        : "Creative-Asset-OpenRouter-Provider ist nicht konfiguriert.",
    );
  }

  const baseUrlRaw =
    normalized(process.env.CREATIVE_ASSET_OPENROUTER_BASE_URL) ??
    "https://openrouter.ai/api/v1";
  const assetHostsRaw = normalized(
    process.env.CREATIVE_ASSET_OPENROUTER_ASSET_HOSTS,
  );

  return {
    kind: "openrouter",
    provider: {
      key: "openrouter",
      apiKey,
      baseUrl: parseHttpsBaseUrl(
        baseUrlRaw,
        "CREATIVE_ASSET_OPENROUTER_BASE_URL",
      ),
      modelAllowlist: parseAllowlist(allowlistRaw),
      defaultModel:
        normalized(process.env.CREATIVE_ASSET_OPENROUTER_DEFAULT_MODEL) ?? null,
      allowedAssetHosts: assetHostsRaw
        ? parseHosts(
            assetHostsRaw,
            "CREATIVE_ASSET_OPENROUTER_ASSET_HOSTS",
          )
        : [],
      timeoutMs: parseTimeout(
        process.env.CREATIVE_ASSET_OPENROUTER_TIMEOUT_MS ??
          process.env.CREATIVE_ASSET_PROVIDER_TIMEOUT_MS,
        "CREATIVE_ASSET_OPENROUTER_TIMEOUT_MS",
      ),
      httpReferer:
        normalized(process.env.CREATIVE_ASSET_OPENROUTER_HTTP_REFERER) ?? null,
      appTitle:
        normalized(process.env.CREATIVE_ASSET_OPENROUTER_APP_TITLE) ?? null,
    },
    storageBucket: getCreativeAssetStorageBucket(),
  };
}

export function getCreativeAssetRuntimeConfig(): CreativeAssetRuntimeConfig {
  const key = getCreativeAssetProviderKeyFromEnv();
  if (!key) {
    throw new Error("Creative-Asset-Provider ist nicht konfiguriert.");
  }
  if (isOpenRouterCreativeAssetProviderKey(key)) {
    return getOpenRouterRuntimeConfig();
  }
  return getHttpRuntimeConfig(key);
}

export function isModelAllowlistedForConfiguredProvider(
  providerKey: string,
  modelId: string,
): boolean {
  if (!hasCreativeAssetProviderConfig()) {
    return false;
  }
  const runtime = getCreativeAssetRuntimeConfig();
  if (runtime.kind === "openrouter") {
    if (providerKey !== "openrouter") {
      return false;
    }
    return runtime.provider.modelAllowlist.includes(modelId);
  }
  if (providerKey !== runtime.provider.key) {
    return false;
  }
  // HTTP provider has no model allowlist beyond job.providerModel length checks.
  return modelId.length >= 1 && modelId.length <= 160;
}
