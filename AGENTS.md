<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Owner preferences (always follow)

- **PR links:** Whenever a pull request is created or updated, always include the full direct GitHub PR URL in the user-facing summary (e.g. `https://github.com/SPOStephan/adbot02/pull/52`) so the owner can open and merge immediately. Do not rely on “PR #N” alone.
- **SQL migrations:** When mentioning a Supabase/SQL migration, always include both the GitHub blob link and the raw link — do not wait to be asked.
- **Beitrag-Push Autonomie:** With Vollautomatik + Freigeben + Autonomie active, boost planning must start automatically for recognized posts — no Abruf and no manual button click. Manual “erneut prüfen” is diagnostic-only, never the primary path.
- **No collateral damage on working Meta writes:** When changing Traffic/Lead launch, kill-switch, mutation plan triggers, organic materializer/preflight/claim, or freeze/refreeze paths, follow `docs/meta-automation/META_WRITE_COLLATERAL_GUARDRAILS.md` and run the smoke SQL `supabase/diagnostics/meta_write_smoke_organic_after_traffic.sql`. Traffic prepare must not permanently strand Beitrag-Push AUTO. Prefer fixing shared-gate coupling over per-plan heals.
- **Content soft-baseline:** First Abruf on a newly connected FB/IG asset must still mark posts published at/after asset connect as `is_new` (see `record_meta_content_candidates`). Do not reintroduce hard baseline that buries fresh posts on extend.
