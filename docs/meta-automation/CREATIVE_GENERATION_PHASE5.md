# Creative Generation Phase 5

Style `reference_asset_ids` wiring into OpenRouter `input_references`.

## Goals

- Allow up to **4** style references per generation job
- Eligible sources:
  - Customer `CUSTOMER` assets: `marked_good` / `performance_winner` / `STYLE_REFERENCE`
  - Inspiration Vault: `INSPIRATION` + `STYLE_REFERENCE`
- OpenRouter: send refs as base64 data URLs in `input_references`
- SQL enqueue gate + Media Library multi-select
- Do not alter locked-photo pixel guard; refs only guide the AI background/image

## Out of scope

- Credits / wallet
- Meta Ad Library scrape
- HTTP provider style wiring (OpenRouter only in Phase 5)

## Artifacts

| Artifact | Path |
| --- | --- |
| Migration | `supabase/migrations/20260819160000_creative_generation_phase5_style_refs.sql` |
| Load | `src/lib/creative-assets/style-reference-load.ts` |
| OpenRouter | `src/lib/creative-assets/providers/openrouter.ts` |
| Policy | `src/lib/creative-assets/map-generation-input.ts` |
| UI | `src/components/MediaLibraryClient.tsx` |
| Tests | `scripts/test-creative-generation-phase5.mjs` |
