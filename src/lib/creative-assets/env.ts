import "server-only";

import type { HttpCreativeAssetProviderConfig } from "./http-provider";

export type CreativeAssetRuntimeConfig = {
  provider: HttpCreativeAssetProviderConfig;
  storageBucket: string;
};

const PROVIDER_ENV_NAMES = [
  "CREATIVE_ASSET_PROVIDER_KEY",
  "CREATIVE_ASSET_PROVIDER_ENDPOINT",
  "CREATIVE_ASSET_PROVIDER_API_KEY",
  "CREATIVE_ASSET_PROVIDER_ASSET_HOSTS",
] as const;

function normalized(value: string | undefined): string | null {
  const result = value?.trim();
  return result ? result : null;
}

function parseTimeout(value: string | undefined): number | undefined {
  const input = normalized(value);
  if (!input) {
    return undefined;
  }
  const milliseconds = Number(input);
  if (!Number.isInteger(milliseconds) || milliseconds < 5_000 || milliseconds > 120_000) {
    throw new Error(
      "CREATIVE_ASSET_PROVIDER_TIMEOUT_MS muss zwischen 5000 und 120000 liegen.",
    );
  }
  return milliseconds;
}

function parseHosts(value: string): string[] {
  const hosts = value
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (hosts.length === 0 || hosts.length > 20) {
    throw new Error(
      "CREATIVE_ASSET_PROVIDER_ASSET_HOSTS muss 1 bis 20 Hostnamen enthalten.",
    );
  }
  for (const host of hosts) {
    if (
      host.includes("://") ||
      host.includes("/") ||
      host.includes("@") ||
      host.includes("*") ||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)
    ) {
      throw new Error(
        "CREATIVE_ASSET_PROVIDER_ASSET_HOSTS enthält einen ungültigen Hostnamen.",
      );
    }
  }
  return [...new Set(hosts)];
}

function parseBucket(value: string | undefined): string {
  const bucket = normalized(value) ?? "creative-assets";
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(bucket)) {
    throw new Error("CREATIVE_ASSET_STORAGE_BUCKET ist ungültig.");
  }
  return bucket;
}

export function hasCreativeAssetProviderConfig(): boolean {
  return PROVIDER_ENV_NAMES.every((name) => normalized(process.env[name]));
}

export function getCreativeAssetRuntimeConfig(): CreativeAssetRuntimeConfig {
  const values = Object.fromEntries(
    PROVIDER_ENV_NAMES.map((name) => [name, normalized(process.env[name])]),
  ) as Record<(typeof PROVIDER_ENV_NAMES)[number], string | null>;

  const configuredCount = Object.values(values).filter(Boolean).length;
  if (configuredCount !== PROVIDER_ENV_NAMES.length) {
    throw new Error(
      configuredCount === 0
        ? "Creative-Asset-Provider ist nicht konfiguriert."
        : "Creative-Asset-Provider ist nur teilweise konfiguriert.",
    );
  }

  return {
    provider: {
      key: values.CREATIVE_ASSET_PROVIDER_KEY as string,
      endpoint: values.CREATIVE_ASSET_PROVIDER_ENDPOINT as string,
      apiKey: values.CREATIVE_ASSET_PROVIDER_API_KEY as string,
      allowedAssetHosts: parseHosts(
        values.CREATIVE_ASSET_PROVIDER_ASSET_HOSTS as string,
      ),
      timeoutMs: parseTimeout(process.env.CREATIVE_ASSET_PROVIDER_TIMEOUT_MS),
    },
    storageBucket: parseBucket(process.env.CREATIVE_ASSET_STORAGE_BUCKET),
  };
}
