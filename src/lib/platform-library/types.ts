export type PlatformMotifCaptionStatus =
  | "pending"
  | "ready"
  | "failed"
  | "skipped";

export type PlatformMotifView = {
  id: string;
  originalFilename: string;
  width: number | null;
  height: number | null;
  mimeType: string;
  tags: string[];
  contentSummary: string | null;
  captionStatus: PlatformMotifCaptionStatus;
  createdAt: string;
  updatedAt: string;
};

export type PlatformMotifMetadata = {
  contract_version: 1;
  library: "platform_motif_library";
  source_kind: "admin_platform_motif";
  never_launch_directly: true;
  clone_to_customer_for_launch: true;
  usable_one_to_one: true;
  usable_as_inspiration: true;
  tags: string[];
  content_summary: string | null;
  caption_status: "pending" | "ready" | "failed" | "skipped";
};
