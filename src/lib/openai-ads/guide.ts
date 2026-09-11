import "server-only";

import { randomUUID } from "node:crypto";

import sharp from "sharp";

import type {
  OpenAIAdsGuide,
  OpenAIAdsGuideStep,
} from "@/lib/openai-ads/guide-types";
import {
  ensureSiteBrandingBucket,
  publicUrlForSiteBrandingPath,
  SITE_BRANDING_BUCKET,
  SITE_BRANDING_CACHE_CONTROL,
  SITE_BRANDING_BUCKET_MAX_BYTES,
} from "@/lib/site-branding/storage";
import { createAdminClient } from "@/lib/supabase/admin";

const GUIDE_MANIFEST_PATH = "openai-ads-guide/manifest.json";
const GUIDE_IMAGE_PREFIX = "openai-ads-guide/images";
const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 600;
const MIN_IMAGE_DIMENSION = 320;
const MAX_IMAGE_DIMENSION = 6000;
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

type StoredGuideStep = {
  id: string;
  title: string;
  description: string;
  sortOrder: number;
  imagePath: string;
  mimeType: string;
  width: number;
  height: number;
  originalFilename: string;
  updatedAt: string;
};

type StoredGuideManifest = {
  contractVersion: 1;
  published: boolean;
  updatedAt: string | null;
  steps: StoredGuideStep[];
};

const EMPTY_MANIFEST: StoredGuideManifest = {
  contractVersion: 1,
  published: false,
  updatedAt: null,
  steps: [],
};

export class OpenAIAdsGuideError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "OpenAIAdsGuideError";
    this.code = code;
    this.status = status;
  }
}

function text(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100
    ? parsed
    : fallback;
}

function normalizeStoredStep(value: unknown): StoredGuideStep | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const id = text(candidate.id, 80);
  const title = text(candidate.title, MAX_TITLE_LENGTH);
  const imagePath = text(candidate.imagePath, 1024);
  const mimeType = text(candidate.mimeType, 40);
  const width = Number(candidate.width);
  const height = Number(candidate.height);
  if (
    !/^[0-9a-f-]{36}$/i.test(id) ||
    !title ||
    !imagePath.startsWith(`${GUIDE_IMAGE_PREFIX}/`) ||
    !ALLOWED_MIME_TYPES.has(mimeType) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < MIN_IMAGE_DIMENSION ||
    height < MIN_IMAGE_DIMENSION ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION
  ) {
    return null;
  }

  return {
    id,
    title,
    description: text(candidate.description, MAX_DESCRIPTION_LENGTH),
    sortOrder: positiveInteger(candidate.sortOrder, 1),
    imagePath,
    mimeType,
    width,
    height,
    originalFilename: text(candidate.originalFilename, 255) || "Screenshot",
    updatedAt: text(candidate.updatedAt, 50) || new Date(0).toISOString(),
  };
}

function normalizeManifest(value: unknown): StoredGuideManifest {
  if (!value || typeof value !== "object") return EMPTY_MANIFEST;
  const candidate = value as Record<string, unknown>;
  const steps = Array.isArray(candidate.steps)
    ? candidate.steps
        .map(normalizeStoredStep)
        .filter((step): step is StoredGuideStep => Boolean(step))
        .sort((left, right) =>
          left.sortOrder === right.sortOrder
            ? left.updatedAt.localeCompare(right.updatedAt)
            : left.sortOrder - right.sortOrder,
        )
        .slice(0, 12)
    : [];

  return {
    contractVersion: 1,
    published: candidate.published === true && steps.length > 0,
    updatedAt: text(candidate.updatedAt, 50) || null,
    steps,
  };
}

async function readManifest(): Promise<StoredGuideManifest> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(SITE_BRANDING_BUCKET)
    .download(GUIDE_MANIFEST_PATH);

  if (error || !data) return EMPTY_MANIFEST;

  try {
    return normalizeManifest(JSON.parse(await data.text()));
  } catch {
    return EMPTY_MANIFEST;
  }
}

async function writeManifest(manifest: StoredGuideManifest): Promise<void> {
  await ensureSiteBrandingBucket();
  const admin = createAdminClient();
  const body = Buffer.from(JSON.stringify(manifest), "utf8");
  const { error } = await admin.storage
    .from(SITE_BRANDING_BUCKET)
    .upload(GUIDE_MANIFEST_PATH, body, {
      contentType: "application/json",
      cacheControl: "0",
      upsert: true,
    });

  if (error) {
    throw new OpenAIAdsGuideError(
      "manifest_write_failed",
      500,
      "Die Anleitungskonfiguration konnte nicht gespeichert werden.",
    );
  }
}

function toPublicGuide(manifest: StoredGuideManifest): OpenAIAdsGuide {
  const steps: OpenAIAdsGuideStep[] = manifest.steps.flatMap((step) => {
    const imageUrl = publicUrlForSiteBrandingPath(step.imagePath);
    return imageUrl ? [{ ...step, imageUrl }] : [];
  });

  return {
    published: manifest.published && steps.length > 0,
    updatedAt: manifest.updatedAt,
    steps,
  };
}

export async function getOpenAIAdsGuideAdmin(): Promise<OpenAIAdsGuide> {
  return toPublicGuide(await readManifest());
}

export async function getPublishedOpenAIAdsGuide(): Promise<OpenAIAdsGuide | null> {
  const guide = toPublicGuide(await readManifest());
  return guide.published && guide.steps.length > 0 ? guide : null;
}

function extensionForMime(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

async function inspectGuideImage(input: {
  bytes: Uint8Array;
  declaredMimeType: string;
}): Promise<{ mimeType: string; width: number; height: number }> {
  if (!ALLOWED_MIME_TYPES.has(input.declaredMimeType)) {
    throw new OpenAIAdsGuideError(
      "unsupported_type",
      400,
      "Nur PNG, JPEG oder WebP sind erlaubt.",
    );
  }
  if (
    input.bytes.byteLength <= 0 ||
    input.bytes.byteLength > SITE_BRANDING_BUCKET_MAX_BYTES
  ) {
    throw new OpenAIAdsGuideError(
      "invalid_size",
      400,
      "Der Screenshot ist leer oder größer als 8 MB.",
    );
  }

  let metadata;
  try {
    metadata = await sharp(input.bytes, { failOn: "error" }).metadata();
  } catch {
    throw new OpenAIAdsGuideError(
      "invalid_image",
      400,
      "Der Screenshot konnte nicht sicher gelesen werden.",
    );
  }

  const detectedMimeType =
    metadata.format === "png"
      ? "image/png"
      : metadata.format === "jpeg"
        ? "image/jpeg"
        : metadata.format === "webp"
          ? "image/webp"
          : null;
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (
    !detectedMimeType ||
    detectedMimeType !== input.declaredMimeType ||
    (metadata.pages ?? 1) !== 1 ||
    width < MIN_IMAGE_DIMENSION ||
    height < MIN_IMAGE_DIMENSION ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION
  ) {
    throw new OpenAIAdsGuideError(
      "invalid_image",
      400,
      `Bitte einen statischen Screenshot zwischen ${MIN_IMAGE_DIMENSION} und ${MAX_IMAGE_DIMENSION} Pixeln je Kante hochladen.`,
    );
  }

  return { mimeType: detectedMimeType, width, height };
}

async function removeObject(path: string | null | undefined): Promise<void> {
  if (!path) return;
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(SITE_BRANDING_BUCKET)
    .remove([path]);
  if (error && !/not found|404/i.test(error.message)) {
    throw new OpenAIAdsGuideError(
      "image_delete_failed",
      500,
      "Der bisherige Screenshot konnte nicht entfernt werden.",
    );
  }
}

export async function saveOpenAIAdsGuideStep(input: {
  stepId?: string | null;
  title: string;
  description: string;
  sortOrder: number;
  file?: {
    bytes: Uint8Array;
    mimeType: string;
    originalFilename: string;
  } | null;
}): Promise<OpenAIAdsGuide> {
  const manifest = await readManifest();
  const stepId = input.stepId?.trim() || randomUUID();
  if (!/^[0-9a-f-]{36}$/i.test(stepId)) {
    throw new OpenAIAdsGuideError("invalid_step", 400, "Ungültiger Anleitungsschritt.");
  }

  const existingIndex = manifest.steps.findIndex((step) => step.id === stepId);
  const existing = existingIndex >= 0 ? manifest.steps[existingIndex] : null;
  if (!existing && manifest.steps.length >= 12) {
    throw new OpenAIAdsGuideError(
      "guide_step_limit",
      409,
      "Die Mini-Anleitung kann höchstens zwölf Schritte enthalten.",
    );
  }
  const title = text(input.title, MAX_TITLE_LENGTH);
  const description = text(input.description, MAX_DESCRIPTION_LENGTH);
  if (!title) {
    throw new OpenAIAdsGuideError("title_required", 400, "Bitte einen Schritttitel eingeben.");
  }
  if (!existing && !input.file) {
    throw new OpenAIAdsGuideError("image_required", 400, "Bitte einen Screenshot auswählen.");
  }

  let imagePath = existing?.imagePath ?? "";
  let mimeType = existing?.mimeType ?? "";
  let width = existing?.width ?? 0;
  let height = existing?.height ?? 0;
  let originalFilename = existing?.originalFilename ?? "Screenshot";
  let uploadedPath: string | null = null;

  if (input.file) {
    const inspected = await inspectGuideImage({
      bytes: input.file.bytes,
      declaredMimeType: input.file.mimeType,
    });
    await ensureSiteBrandingBucket();
    imagePath = `${GUIDE_IMAGE_PREFIX}/${stepId}/${Date.now().toString(36)}.${extensionForMime(inspected.mimeType)}`;
    const admin = createAdminClient();
    const { error } = await admin.storage
      .from(SITE_BRANDING_BUCKET)
      .upload(imagePath, input.file.bytes, {
        contentType: inspected.mimeType,
        cacheControl: SITE_BRANDING_CACHE_CONTROL,
        upsert: false,
      });
    if (error) {
      throw new OpenAIAdsGuideError(
        "image_upload_failed",
        500,
        "Der Screenshot konnte nicht hochgeladen werden.",
      );
    }
    uploadedPath = imagePath;
    mimeType = inspected.mimeType;
    width = inspected.width;
    height = inspected.height;
    originalFilename = text(input.file.originalFilename, 255) || "Screenshot";
  }

  const updatedAt = new Date().toISOString();
  const updatedStep: StoredGuideStep = {
    id: stepId,
    title,
    description,
    sortOrder: positiveInteger(input.sortOrder, manifest.steps.length + 1),
    imagePath,
    mimeType,
    width,
    height,
    originalFilename,
    updatedAt,
  };

  const steps = manifest.steps.filter((step) => step.id !== stepId);
  steps.push(updatedStep);
  steps.sort((left, right) => left.sortOrder - right.sortOrder);
  const next: StoredGuideManifest = {
    contractVersion: 1,
    published: manifest.published,
    updatedAt,
    steps: steps.slice(0, 12),
  };

  try {
    await writeManifest(next);
  } catch (error) {
    await removeObject(uploadedPath).catch(() => undefined);
    throw error;
  }

  if (uploadedPath && existing?.imagePath && existing.imagePath !== uploadedPath) {
    await removeObject(existing.imagePath).catch(() => undefined);
  }

  return toPublicGuide(next);
}

export async function setOpenAIAdsGuidePublished(
  published: boolean,
): Promise<OpenAIAdsGuide> {
  const manifest = await readManifest();
  if (published && manifest.steps.length === 0) {
    throw new OpenAIAdsGuideError(
      "guide_empty",
      409,
      "Bitte zuerst mindestens einen Anleitungsschritt hochladen.",
    );
  }

  const next: StoredGuideManifest = {
    ...manifest,
    published,
    updatedAt: new Date().toISOString(),
  };
  await writeManifest(next);
  return toPublicGuide(next);
}

export async function removeOpenAIAdsGuideStep(
  stepId: string,
): Promise<OpenAIAdsGuide> {
  if (!/^[0-9a-f-]{36}$/i.test(stepId)) {
    throw new OpenAIAdsGuideError("invalid_step", 400, "Ungültiger Anleitungsschritt.");
  }
  const manifest = await readManifest();
  const existing = manifest.steps.find((step) => step.id === stepId);
  if (!existing) {
    throw new OpenAIAdsGuideError("step_not_found", 404, "Anleitungsschritt nicht gefunden.");
  }

  const steps = manifest.steps.filter((step) => step.id !== stepId);
  const next: StoredGuideManifest = {
    ...manifest,
    published: manifest.published && steps.length > 0,
    updatedAt: new Date().toISOString(),
    steps,
  };
  await writeManifest(next);
  await removeObject(existing.imagePath).catch(() => undefined);
  return toPublicGuide(next);
}
