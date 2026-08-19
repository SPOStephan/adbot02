# Creative Generation Phase 3

`locked_photo` compose: AI background + **1:1 embed** of one customer `LOCKED_PHOTO`, with a **pixel guard** that rejects any alteration of the locked region.

## Goals

- Enable `mode=locked_photo` on the existing enqueue + worker path
- Exactly **one** locked photo per job (Phase 3 limit)
- Never scale/crop/recolor the locked photo — embed only
- Force `output.mime_type=image/png` so the pixel guard stays meaningful (lossless)
- SQL enqueue gate: asset must be owned, `CUSTOMER`, `asset_role=LOCKED_PHOTO`, `READY`, `APPROVED`
- Do not touch organic boost / launch materialize
- Still no credit charge for image generation

## Out of scope

- Multiple locked photos in one compose
- Style `reference_asset_ids` wiring
- Media Library generate UI
- Credits / wallet for `creative.generate_image_master`
- Sending locked photo bytes to the image provider (compose is local)

## Flow

1. Provider generates a **background** from the prompt (same OpenRouter/HTTP path as free).
2. Worker loads the locked photo from private storage and re-verifies sha256/dims.
3. Canvas is sized to fit the locked photo at 1:1 and the optional `aspect_hint`.
4. Background is cover-resized to the canvas; locked photo is composited at integer `(left, top)`.
5. Pixel guard compares raw RGBA of the placement region to the locked photo decode — must match exactly.
6. Result is stored as `GENERATED` with metadata `locked_photo_compose`.

## Artifacts

| Artifact | Path |
| --- | --- |
| Migration | `supabase/migrations/20260819120000_creative_generation_phase3_locked_photo.sql` |
| Load | `src/lib/creative-assets/locked-photo-load.ts` |
| Compose + pixel guard | `src/lib/creative-assets/locked-photo-compose.ts` |
| Policy | `src/lib/creative-assets/map-generation-input.ts` |
| Worker hook | `src/lib/creative-assets/worker.ts` |
| Tests | `scripts/test-creative-generation-phase3.mjs` |

## Enqueue example

```json
{
  "brandProfileId": "uuid",
  "contract_version": "adbot-creative-generation-v1",
  "mode": "locked_photo",
  "provider_key": "openrouter",
  "model_id": "google/gemini-2.5-flash-image",
  "prompt": "Soft studio backdrop, leave center clear",
  "reference_asset_ids": [],
  "locked_photo_asset_ids": ["uuid-of-LOCKED_PHOTO"],
  "output": { "mime_type": "image/png", "aspect_hint": "1:1" }
}
```

## Credits

Still **not** reserved/charged in Phase 3.
