# Creative Generation Phase 1

Schema + contracts only. **No live external image API calls.**

## Goals

- Label brand assets for generation (`asset_role`, `training_status`)
- Treat Inspiration Vault as style corpus (`STYLE_REFERENCE`)
- Define model-open input contract v1 (`provider_key` + `model_id`) ready for OpenRouter in Phase 2
- Keep Media Library SELECT grants/columns in sync

## Out of scope

- OpenRouter / HTTP image client
- Worker or cron changes that call external APIs
- Organic boost / launch materialize changes

## Artifacts

| Artifact | Path |
| --- | --- |
| Migration | `supabase/migrations/20260818230000_creative_generation_phase1_contract.sql` |
| TS contract | `src/lib/creative-assets/generation-contract.ts` |
| Customer columns | `src/lib/media-library/customer-asset-columns.ts` |
| Tests | `scripts/test-creative-generation-phase1.mjs` |

## Modes

- `free` — optional style references; no locked photos
- `locked_photo` — at least one `locked_photo_asset_ids` entry (embed-only photos)

## Roles

See `MEDIA_LIBRARY_AND_INSPIRATION_VAULT.md`. `LOCKED_PHOTO` is CUSTOMER-only; Inspiration rows must be `STYLE_REFERENCE`.
