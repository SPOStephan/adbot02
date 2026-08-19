# Creative Generation Phase 7

Meta format-slot crops after successful image generation.

## Goals

- After master `GENERATED` completes, create cover crops for missing Meta slots
  (`meta_feed_1x1`, `meta_feed_4x5`, `meta_story_9x16`)
- Register children as `source_type`/`asset_role` = `GENERATED` with
  `metadata.source_kind = generated_meta_crop` + `parent_asset_id`
- Reuse existing `generateMetaCropsFromOriginal` / `presetsNeedingCrop`
- Best-effort: crop failures never fail a successful generation
- Do not touch organic boost / launch materialize / credits pricing
- Ad Library scrape and auto `performance_winner` remain out of scope

## Flow

1. Worker completes master (as Phase 2–6)  
2. Metadata gets `format_slots.crops_planned`  
3. `registerGeneratedMetaFormatSlots` → sharp cover crops  
4. `register_generated_meta_crop_asset` for each child  

## Artifacts

| Artifact | Path |
| --- | --- |
| Migration | `supabase/migrations/20260819200000_creative_generation_phase7_format_slots.sql` |
| Helper | `src/lib/creative-assets/generated-meta-crops.ts` |
| Worker | `src/lib/creative-assets/worker.ts` |
| Tests | `scripts/test-creative-generation-phase7.mjs` |

## Intentionally deferred

- Auto `performance_winner` Insights job
- Meta Ad Library scraper
- Separate credit price for crop registration (crops are free side-effect of master)
