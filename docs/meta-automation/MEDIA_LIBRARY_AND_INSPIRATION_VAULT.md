# Media Library & Inspiration Vault

## Zweck

| Scope | Sichtbarkeit | Verwendung |
|---|---|---|
| `CUSTOMER` | Kunde (eigene Zeilen) | Media Library, Meta Active Launch |
| `INSPIRATION` | nur Site-Admins | Lernkorpus für spätere Generierung — **nie** Meta-Launch |

Beide liegen in `public.brand_assets` (`library_scope`). Bytes im privaten Bucket `creative-assets`.

## Kunden-Upload

1. UI: `/dashboard/creatives`
2. API: `POST /api/meta/automation/asset-upload` (multipart `file` + `brandProfileId`)
3. RPC: `register_uploaded_brand_asset` → `source_type=UPLOADED`, `READY`/`APPROVED`
4. Danach im Automation Control Center als Brand-Asset wählbar

## Inspiration Vault

1. UI: `/dashboard/inspiration` (Site-Admin)
2. API: `POST /api/admin/inspiration-vault/upload`
3. RPC: `register_inspiration_vault_asset` (prüft `site_admins`)
4. Hard Guards: RLS, Executor-Filter, Trigger auf `mutation_plans` / `mutation_plan_steps`

## SQL

Migration: `supabase/migrations/20260809190000_media_library_and_inspiration_vault.sql`
