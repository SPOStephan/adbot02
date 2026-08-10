/** Browser-safe parse for asset-upload responses that sometimes return HTML. */

export type AssetUploadResponse = {
  ok?: boolean;
  error?: string;
  code?: string;
  brandAssetId?: string;
  preferredLaunchAssetId?: string;
  originalFilename?: string;
  width?: number;
  height?: number;
  assets?: Array<{
    brandAssetId?: string;
    originalFilename?: string;
    width?: number;
    height?: number;
    label?: string;
    role?: string;
  }>;
};

export async function parseAssetUploadResponse(
  response: Response,
): Promise<AssetUploadResponse> {
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();

  if (!raw.trim()) {
    throw new Error(
      `Upload-Antwort leer (HTTP ${response.status}). Bitte erneut versuchen.`,
    );
  }

  if (
    !contentType.includes("application/json") ||
    raw.trimStart().startsWith("<!")
  ) {
    throw new Error(
      `Upload-Server antwortete nicht mit JSON (HTTP ${response.status}). ` +
        "Oft Timeout oder Bildverarbeitung — bitte kleineres JPG versuchen oder Seite neu laden.",
    );
  }

  try {
    return JSON.parse(raw) as AssetUploadResponse;
  } catch {
    throw new Error(
      `Upload-Antwort ungültig (HTTP ${response.status}). Bitte erneut versuchen.`,
    );
  }
}
