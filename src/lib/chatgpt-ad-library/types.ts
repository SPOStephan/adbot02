/** External ChatGPT Ad Library (chatgptadlibrary.com) — admin-only corpus. */

export const CHATGPT_AD_LIBRARY_PROVIDER = "chatgptadlibrary.com";
export const CHATGPT_AD_LIBRARY_ORIGIN = "https://www.chatgptadlibrary.com";
export const CHATGPT_AD_LIBRARY_IMAGE_HOST = "img.chatgptadlibrary.com";

export type ChatGPTAdLibraryRecord = {
  id: number | string;
  sourceUrl: string;
  advertiserName: string;
  title: string;
  body: string;
  imageUrl: string;
  landingPageUrl: string | null;
  triggeringPrompts: string[];
  category: string[];
};

export type ChatGPTAdLibraryImportResult = {
  externalId: string;
  status: "imported" | "refreshed" | "skipped_duplicate" | "failed";
  brandAssetId: string | null;
  error: string | null;
};

export type ChatGPTAdLibraryImportSummary = {
  attempted: number;
  imported: number;
  refreshed: number;
  skippedDuplicate: number;
  failed: number;
  results: ChatGPTAdLibraryImportResult[];
};
