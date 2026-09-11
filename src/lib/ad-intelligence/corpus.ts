import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type AdIntelligenceCorpusSummary = {
  datasetVersion: string;
  records: number;
  trainRecords: number;
  evalRecords: number;
  platforms: Record<string, number>;
  industries: number;
  rightsClean: boolean;
};

type Manifest = {
  dataset_version?: unknown;
  records?: unknown;
  train_records?: unknown;
  eval_records?: unknown;
  platform_distribution?: unknown;
  industry_distribution?: unknown;
  contains_customer_data?: unknown;
  contains_third_party_ads?: unknown;
};

export async function loadAdIntelligenceCorpusSummary(): Promise<
  AdIntelligenceCorpusSummary | null
> {
  try {
    const raw = await readFile(
      join(
        process.cwd(),
        "training/ad-intelligence/v1/manifest.json",
      ),
      "utf8",
    );
    const value = JSON.parse(raw) as Manifest;
    if (
      typeof value.dataset_version !== "string" ||
      typeof value.records !== "number" ||
      typeof value.train_records !== "number" ||
      typeof value.eval_records !== "number" ||
      !value.platform_distribution ||
      typeof value.platform_distribution !== "object" ||
      Array.isArray(value.platform_distribution) ||
      !value.industry_distribution ||
      typeof value.industry_distribution !== "object" ||
      Array.isArray(value.industry_distribution)
    ) {
      return null;
    }
    const platforms = Object.fromEntries(
      Object.entries(value.platform_distribution).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      ),
    );
    return {
      datasetVersion: value.dataset_version,
      records: value.records,
      trainRecords: value.train_records,
      evalRecords: value.eval_records,
      platforms,
      industries: Object.keys(value.industry_distribution).length,
      rightsClean:
        value.contains_customer_data === false &&
        value.contains_third_party_ads === false,
    };
  } catch {
    return null;
  }
}
