# Creative Generation Phase 8

Auto-label `brand_assets.training_status = performance_winner` from Meta Insights.

## Goals

- After marketing sync, merge creative `image_hash` / `image_url` into `creatives.content`
- Rank customer assets by 7-day ad performance (same success-control metrics)
- Promote top **5** assets with `primary_results > 0`
- Never overwrite customer `marked_good`
- Demote stale `performance_winner` labels no longer in the top set
- Do not touch organic boost / launch materialize / credit pricing
- Ad Library scrape remains out of scope

## Flow

1. `replace_meta_marketing_snapshot` (unchanged body)  
2. `merge_meta_creative_media_fields` (hash/url into content)  
3. `apply_brand_asset_performance_winners` (top-N labels)  

## Ranking

- Window: last 7 days ending at max `performance_data.date`
- Objectives: traffic / leads / sales (inline_link_clicks / leads / purchases)
- Join ad → creative → asset via `meta_image_hash` or `source_meta_asset_id`
- Aggregate to asset; sort like success-control sibling rank

## Artifacts

| Artifact | Path |
| --- | --- |
| Migration | `supabase/migrations/20260820200000_creative_generation_phase8_performance_winners.sql` |
| Hook | `src/lib/meta/marketing-sync.ts` |
| Tests | `scripts/test-creative-generation-phase8.mjs` |

## Intentionally deferred

- Meta Ad Library scraper
- ROAS-first ranking
- Auto-import of winning Meta creatives into Media Library
- Customer UI to set `performance_winner`
