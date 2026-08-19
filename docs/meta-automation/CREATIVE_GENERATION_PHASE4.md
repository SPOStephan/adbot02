# Creative Generation Phase 4

Media Library UI for generate + mark flows on top of Phase 2/3 APIs.

## Goals

- `/dashboard/creatives`: KI generate section (`free` + `locked_photo`)
- Per-asset: mark/clear `marked_good`, toggle `LOCKED_PHOTO`
- Public config API (no secrets) for provider key + model allowlist
- SQL RPC to set locked role (customers had no write path before)
- Do not touch organic boost / launch materialize / credits

## Artifacts

| Artifact | Path |
| --- | --- |
| Migration | `supabase/migrations/20260819140000_creative_generation_phase4_media_ui.sql` |
| Config API | `GET /api/meta/automation/creative-assets/config` |
| Training API | `POST /api/media-library/training-status` |
| Locked API | `POST /api/media-library/locked-photo` |
| UI | `src/components/MediaLibraryClient.tsx` |
| Tests | `scripts/test-creative-generation-phase4.mjs` |

## Customer flow

1. Upload creative (unchanged)
2. Schloss → `LOCKED_PHOTO` (READY/APPROVED only)
3. Stern → `marked_good` (learning corpus later)
4. Generate Free or Locked Photo → enqueue job → worker → `GENERATED` asset

## Out of scope

- Style `reference_asset_ids` wiring
- Credits / wallet
- Inspiration vault UI changes
- Meta Ad Library scrape
