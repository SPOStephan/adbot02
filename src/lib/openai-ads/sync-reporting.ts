import type { OpenAIAdsInsight } from "@/lib/openai-ads/client";
import { accountLocalDateToUnix } from "@/lib/openai-ads/launch-safety";

export type OpenAIAdsReportingWindow = {
  date: string;
  startUnix: number;
  endUnix: number;
};

function localDateAtUnix(unix: number, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date(unix * 1000))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftCalendarDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

export function completeAccountLocalReportingRange(input: {
  nowUnix: number;
  timeZone: string;
  days: number;
}) {
  if (!Number.isSafeInteger(input.days) || input.days < 1 || input.days > 90) {
    throw new Error("invalid_reporting_day_count");
  }
  const currentLocalDate = localDateAtUnix(input.nowUnix, input.timeZone);
  const startLocalDate = shiftCalendarDate(currentLocalDate, -input.days);
  const startUnix = accountLocalDateToUnix(startLocalDate, input.timeZone);
  const endUnix = accountLocalDateToUnix(currentLocalDate, input.timeZone);
  if (startUnix === null || endUnix === null || endUnix <= startUnix) {
    throw new Error("reporting_range_invalid");
  }
  return { startUnix, endUnix };
}

export function accountLocalReportingWindows(input: {
  startUnix: number;
  endUnix: number;
  timeZone: string;
}): OpenAIAdsReportingWindow[] {
  if (input.endUnix <= input.startUnix) return [];
  const firstDate = localDateAtUnix(input.startUnix, input.timeZone);
  const lastDate = localDateAtUnix(input.endUnix - 1, input.timeZone);
  const windows: OpenAIAdsReportingWindow[] = [];
  for (let date = firstDate; date <= lastDate; date = shiftCalendarDate(date, 1)) {
    const nextDate = shiftCalendarDate(date, 1);
    const localStart = accountLocalDateToUnix(date, input.timeZone);
    const localEnd = accountLocalDateToUnix(nextDate, input.timeZone);
    if (localStart === null || localEnd === null || localEnd <= localStart) {
      throw new Error("reporting_window_invalid");
    }
    windows.push({ date, startUnix: localStart, endUnix: localEnd });
  }
  if (
    windows.length === 0 ||
    windows[0].startUnix !== input.startUnix ||
    windows.at(-1)?.endUnix !== input.endUnix
  ) {
    throw new Error("reporting_range_not_full_local_days");
  }
  return windows;
}

export function buildOpenAIAdsConversionRequests(input: {
  campaignIds: string[];
  windows: OpenAIAdsReportingWindow[];
  chunkSize?: number;
}) {
  const chunkSize = input.chunkSize ?? 500;
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) {
    throw new Error("invalid_conversion_chunk_size");
  }
  const chunks: string[][] = [];
  for (let index = 0; index < input.campaignIds.length; index += chunkSize) {
    chunks.push(input.campaignIds.slice(index, index + chunkSize));
  }
  return input.windows.flatMap((window) =>
    chunks.map((campaignIds) => ({ ...window, campaignIds })),
  );
}

export function assertOpenAIAdsDeliveryCoverage(input: {
  campaignIds: string[];
  windows: OpenAIAdsReportingWindow[];
  insights: OpenAIAdsInsight[];
}): void {
  const campaignIds = new Set(input.campaignIds);
  const reportingDates = new Set(input.windows.map((item) => item.date));
  const returned = new Set<string>();
  for (const insight of input.insights) {
    const key = `${insight.campaign_id}:${insight.readable_time}`;
    if (
      !campaignIds.has(insight.campaign_id) ||
      !reportingDates.has(insight.readable_time) ||
      returned.has(key)
    ) {
      throw new Error("delivery_insights_incomplete");
    }
    returned.add(key);
  }
  if (returned.size !== campaignIds.size * reportingDates.size) {
    throw new Error("delivery_insights_incomplete");
  }
}
