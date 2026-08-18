/**
 * Columns authenticated customers may SELECT on brand_assets
 * (see grant in media_library_and_inspiration_vault migration).
 * Selecting anything else makes the PostgREST query fail and the library
 * looks empty — never add columns here without a matching GRANT.
 */
export const CUSTOMER_BRAND_ASSET_LIST_COLUMNS = [
  "id",
  "user_id",
  "platform_account_id",
  "original_filename",
  "source_meta_asset_id",
  "source_type",
  "library_scope",
  "width",
  "height",
  "meta_image_hash",
  "status",
  "moderation_status",
  "mime_type",
  "byte_size",
  "created_at",
  "updated_at",
] as const;

export const CUSTOMER_BRAND_ASSET_LIST_SELECT =
  CUSTOMER_BRAND_ASSET_LIST_COLUMNS.join(",");

/** Subset used by the Media Library creatives page. */
export const MEDIA_LIBRARY_ASSET_LIST_SELECT = [
  "id",
  "original_filename",
  "width",
  "height",
  "source_type",
  "status",
  "meta_image_hash",
  "created_at",
  "library_scope",
].join(",");
