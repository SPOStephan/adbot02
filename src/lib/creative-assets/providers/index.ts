import "server-only";

import {
  getCreativeAssetRuntimeConfig,
  type CreativeAssetRuntimeConfig,
} from "../env";
import { HttpCreativeAssetProvider } from "../http-provider";
import type { CreativeAssetProvider } from "../types";
import { OpenRouterCreativeAssetProvider } from "./openrouter";

export { OpenRouterCreativeAssetProvider } from "./openrouter";
export type { OpenRouterCreativeAssetProviderConfig } from "./openrouter";

/**
 * Build the configured creative-asset provider map (HTTP and/or OpenRouter).
 * Currently one active provider key from env; Map keeps worker lookup stable.
 */
export function createCreativeAssetProviders(
  runtime: CreativeAssetRuntimeConfig = getCreativeAssetRuntimeConfig(),
): ReadonlyMap<string, CreativeAssetProvider> {
  if (runtime.kind === "openrouter") {
    const provider = new OpenRouterCreativeAssetProvider(runtime.provider);
    return new Map([[provider.key, provider]]);
  }

  const provider = new HttpCreativeAssetProvider(runtime.provider);
  return new Map([[provider.key, provider]]);
}

export function getConfiguredCreativeAssetProviderKey(): string {
  const runtime = getCreativeAssetRuntimeConfig();
  return runtime.provider.key;
}
