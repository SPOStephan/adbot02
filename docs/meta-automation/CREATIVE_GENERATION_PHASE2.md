# Creative Generation Phase 2

Live OpenRouter Image API wiring for **mode=`free` only**. Compose / `locked_photo` is deferred.

## Goals

- Provider registry: `http` (existing) and `openrouter` (new)
- Real `POST https://openrouter.ai/api/v1/images` with model allowlist
- Authenticated enqueue API (no full dashboard UI)
- Completed GENERATED assets get `asset_role = GENERATED`
- Do not touch organic boost / launch materialize

## Out of scope

- `locked_photo` compose (rejected with clear non-retryable policy error)
- `reference_asset_ids` style wiring (rejected fail-closed until later)
- Credit charging for `creative.generate_image_master` (skipped in Phase 2 so testing is not wallet-blocked)

## Artifacts

| Artifact | Path |
| --- | --- |
| Migration | `supabase/migrations/20260819100000_creative_generation_phase2_openrouter.sql` |
| OpenRouter provider | `src/lib/creative-assets/providers/openrouter.ts` |
| Provider factory | `src/lib/creative-assets/providers/index.ts` |
| Phase 2 gates | `src/lib/creative-assets/map-generation-input.ts` |
| Enqueue helper | `src/lib/creative-assets/enqueue.ts` |
| Enqueue route | `POST /api/meta/automation/creative-assets/enqueue` |
| Tests | `scripts/test-creative-generation-phase2.mjs` |

## Env (OpenRouter — all-or-nothing when `CREATIVE_ASSET_PROVIDER_KEY=openrouter`)

| Variable | Required | Notes |
| --- | --- | --- |
| `CREATIVE_ASSET_PROVIDER_KEY` | yes | Must be `openrouter` |
| `OPENROUTER_API_KEY` or `CREATIVE_ASSET_OPENROUTER_API_KEY` | yes | Bearer key |
| `CREATIVE_ASSET_OPENROUTER_MODEL_ALLOWLIST` | yes | Comma-separated model slugs |
| `CREATIVE_ASSET_OPENROUTER_DEFAULT_MODEL` | no | Must be in allowlist if set |
| `CREATIVE_ASSET_OPENROUTER_BASE_URL` | no | Default `https://openrouter.ai/api/v1` |
| `CREATIVE_ASSET_OPENROUTER_TIMEOUT_MS` | no | 5000–120000; falls back to `CREATIVE_ASSET_PROVIDER_TIMEOUT_MS` |
| `CREATIVE_ASSET_OPENROUTER_ASSET_HOSTS` | no* | Required only if responses return URLs (prefer `b64_json`) |
| `CREATIVE_ASSET_OPENROUTER_HTTP_REFERER` | no | OpenRouter `HTTP-Referer` |
| `CREATIVE_ASSET_OPENROUTER_APP_TITLE` | no | OpenRouter `X-Title` |
| `CREATIVE_ASSET_STORAGE_BUCKET` | no | Default `creative-assets` |

HTTP provider (`CREATIVE_ASSET_PROVIDER_KEY=http` or any non-`openrouter` key) keeps the existing endpoint / API key / asset host env vars.

## Enqueue API

`POST /api/meta/automation/creative-assets/enqueue`

Auth: same Meta customer session as other automation routes.

Body (generation contract + brand profile):

```json
{
  "brandProfileId": "uuid",
  "contract_version": "adbot-creative-generation-v1",
  "mode": "free",
  "provider_key": "openrouter",
  "model_id": "google/gemini-2.5-flash-image",
  "prompt": "…",
  "reference_asset_ids": [],
  "locked_photo_asset_ids": [],
  "output": { "mime_type": "image/png", "aspect_hint": "1:1" }
}
```

Success: `{ "ok": true, "jobId": "uuid" }`.

Worker cron `/api/cron/creative-assets` claims and runs the job via the provider registry.

## Credits

Phase 2 **does not** reserve/charge `creative.generate_image_master`. Attach billing in a later phase when product UX is ready.
