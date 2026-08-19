# Media Library & Inspiration Vault

## Zweck

| Scope | Sichtbarkeit | Verwendung |
|---|---|---|
| `CUSTOMER` | Kunde (eigene Zeilen) | Media Library, Meta Active Launch |
| `INSPIRATION` | nur Site-Admins | Lern-/Style-Korpus für Creative Generation — **nie** Meta-Launch |

Beide liegen in `public.brand_assets` (`library_scope`). Bytes im privaten Bucket `creative-assets`.

## Asset-Rollen (`asset_role`)

| Rolle | Bedeutung |
|---|---|
| `LOCKED_PHOTO` | Muss unverändert bleiben; nur Embed in Compose. Nur `CUSTOMER`. |
| `UPLOAD_EDITABLE` | Normaler Kunden-Upload (Default für Media Library). |
| `GENERATED` | KI-Ausgabe (`source_type = GENERATED`). |
| `STYLE_REFERENCE` | Style-/Inspirationsreferenz. Inspiration-Vault-Zeilen sind immer diese Rolle. |

## Training-Status (`training_status`)

| Status | Bedeutung |
|---|---|
| `none` | Default |
| `marked_good` | Kunde markiert als gutes Beispiel (RPC `mark_brand_asset_training_status`) |
| `performance_winner` | System-Label (Phase 2+); nicht vom Kunden gesetzt |

Kunden dürfen nur `marked_good` setzen oder auf `none` zurücksetzen — und nur für eigene `CUSTOMER`-Assets.

## Kunden-Upload

1. UI: `/dashboard/creatives`
2. API: `POST /api/meta/automation/asset-upload` (multipart `file`; `brandProfileId` optional)
3. RPC: `register_uploaded_brand_asset` → `source_type=UPLOADED`, `asset_role=UPLOAD_EDITABLE`, `READY`/`APPROVED`
4. Brand-Profil ist **kein** Upload-Gate. Ohne Profil wird das Asset unbound gespeichert und beim Active Launch über `bind_unbound_customer_brand_asset_for_launch` an das Launch-Profil gebunden.
5. Danach im Automation Control Center als Brand-Asset wählbar
6. Phase 4 UI: Stern → `mark_brand_asset_training_status`; Schloss → `set_brand_asset_locked_photo_role`; Abschnitt „KI-Creative erzeugen“ → enqueue

SQL-Nachzug:
- `supabase/migrations/20260809193000_media_library_upload_without_brand_profile.sql`
- `supabase/migrations/20260809194500_fix_library_scope_trigger_short_circuit.sql` (Pflicht: verhindert `record "new" has no field "library_scope"` beim Beitrag-Push)
- `supabase/migrations/20260818230000_creative_generation_phase1_contract.sql` (Rollen, Training-Status, Generation-Contract)

## Inspiration Vault

1. UI: `/dashboard/inspiration` (Site-Admin)
2. API: `POST /api/admin/inspiration-vault/upload`
3. RPC: `register_inspiration_vault_asset` (prüft `site_admins`) → `asset_role=STYLE_REFERENCE`
4. Hard Guards: RLS, Executor-Filter, Trigger auf `mutation_plans` / `mutation_plan_steps`
5. Phase-1-Generation: Vault-IDs dürfen als `reference_asset_ids` (Style-Korpus) im Contract vorkommen — **kein** Live-Provider in Phase 1

## Customer SELECT-Spalten

Authenticated erhält column-level `GRANT SELECT` u. a. für `asset_role`, `training_status`, `marked_good_at`, `marked_good_by`, `style_notes`. Die TypeScript-Liste `CUSTOMER_BRAND_ASSET_LIST_COLUMNS` / `MEDIA_LIBRARY_ASSET_LIST_SELECT` muss mit den Grants übereinstimmen — fehlende Grants lassen die Creatives-UI leer wirken.

## SQL

Migrationen:
- `supabase/migrations/20260809190000_media_library_and_inspiration_vault.sql`
- `supabase/migrations/20260818230000_creative_generation_phase1_contract.sql`
