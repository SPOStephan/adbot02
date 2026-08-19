# Creative Generation Phase 6

Credits + audit for image generation (`creative.generate_image_master`).

## Goals

- Reserve catalog credits (**20**) at enqueue for `free` and `locked_photo`
- Persist `credit_reservation_id` on `creative_asset_jobs`
- Worker **commit** on success, **release** on terminal `FAILED` / `AMBIGUOUS`
- Enrich queue audit with mode / model / refs / reservation
- Attach billing block on completed asset metadata
- Do not touch organic boost / launch materialize
- Ad Library scrape remains out of scope

## Flow

1. `reserveCredits(creative.generate_image_master)` TTL 24h  
2. `enqueue_creative_asset_job(..., p_credit_reservation_id)`  
3. Worker claim returns reservation id  
4. Success → `commit_credit_reservation`  
5. Terminal failure → `release_credit_reservation`  
6. Retryable failure → keep reservation  

## Artifacts

| Artifact | Path |
| --- | --- |
| Migration | `supabase/migrations/20260819180000_creative_generation_phase6_credits.sql` |
| Enqueue | `src/lib/creative-assets/enqueue.ts` |
| Worker | `src/lib/creative-assets/worker.ts` |
| API | `POST /api/meta/automation/creative-assets/enqueue` (402 on insufficient) |
| Tests | `scripts/test-creative-generation-phase6.mjs` |

## Intentionally deferred

- Separate `locked_compose` price key (both modes use `generate_image_master`)
- Auto performance_winner Insights job
- Meta Ad Library scraper
