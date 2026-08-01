# Phase 15 — Meta AdCreative/AdImage contract reference

Retrieved: 2026-07-30

Official references:

- https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-creative
- https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-image

Verified contract details for Marketing API v25.0:

1. `AdCreative` exposes `image_hash`, `image_url`, and `thumbnail_url` as readable fields. Meta documents `thumbnail_width` and `thumbnail_height` as render-size parameters for `thumbnail_url`.
2. `image_hash` identifies an image already present in the ad account image library. `image_url` must not be sent together with `image_hash` when creating a creative.
3. The `AdImage` edge returns `hash`, dimensions, a temporary retrievable `url`, and `permalink_url`. The temporary URL is not intended to be used directly for creative creation.
4. A previously uploaded hash can be used directly for an ad creative. Otherwise an image can be uploaded to `/act_{ad_account_id}/adimages`, and its returned hash can then be bound into the creative.
5. Phase 15 therefore supports two safe paths: reuse a verified account-local Meta image hash when the synced creative exposes one; otherwise materialize and validate the account-bound Creative image, persist it privately, and let the existing launch saga upload it before `CREATE_AD_CREATIVE`.

Security implications:

- The browser must never provide a fetch URL. A customer selects a tenant-owned synced Creative ID only.
- The server resolves image URL/hash from the tenant-owned Creative projection (and can refresh from Meta), validates HTTPS and an allowlisted Meta CDN host, enforces byte/MIME/dimension limits, hashes bytes, and stores them in a private bucket.
- The service-role-only import RPC persists only validated metadata and emits a hash-chained customer audit event; no access token or source CDN URL enters the audit log.
