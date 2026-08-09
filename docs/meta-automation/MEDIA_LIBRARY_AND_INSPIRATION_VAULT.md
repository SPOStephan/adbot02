# Media Library & Inspiration Vault

## Zweck

| Scope | Sichtbarkeit | Verwendung |
|---|---|---|
| `CUSTOMER` | Kunde (eigene Zeilen) | Media Library, Meta Active Launch |
| `INSPIRATION` | nur Site-Admins | Lernkorpus für spätere Generierung — **nie** Meta-Launch |

Beide liegen in `public.brand_assets` (`library_scope`). Bytes im privaten Bucket `creative-assets`.

## Kunden-Upload

1. UI: `/dashboard/creatives`
2. API: `POST /api/meta/automation/asset-upload` (multipart `file`; `brandProfileId` optional)
3. RPC: `register_uploaded_brand_asset` → `source_type=UPLOADED`, `READY`/`APPROVED`
4. Brand-Profil ist **kein** Upload-Gate. Ohne Profil wird das Asset unbound gespeichert und beim Active Launch über `bind_unbound_customer_brand_asset_for_launch` an das Launch-Profil gebunden.
5. Danach im Automation Control Center als Brand-Asset wählbar

SQL-Nachzug: `supabase/migrations/20260809193000_media_library_upload_without_brand_profile.sql`

## Inspiration Vault

1. UI: `/dashboard/inspiration` (Site-Admin)
2. API: `POST /api/admin/inspiration-vault/upload`
3. RPC: `register_inspiration_vault_asset` (prüft `site_admins`)
4. Hard Guards: RLS, Executor-Filter, Trigger auf `mutation_plans` / `mutation_plan_steps`

## SQL

Migration: `supabase/migrations/20260809190000_media_library_and_inspiration_vault.sql`
