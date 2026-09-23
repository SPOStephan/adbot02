# Media Library, Motivbibliothek & Inspiration Vault

## Zweck

| Scope | Sichtbarkeit | Verwendung |
|---|---|---|
| `CUSTOMER` | nur der besitzende Kunde (`user_id` + RLS) | Kundenbibliothek: eigene fertige Bilder/Grafiken. Adbot darf **1:1 nutzen oder anpassen**. Meta Active Launch nur hier. **Nie** Account-übergreifend. |
| `PLATFORM` | nur Site-Admins | Globale, handkuratierte Adbot-Motivbibliothek. Adbot darf **1:1 übernehmen oder als Inspiration** nutzen. Launch nur nach Clone in `CUSTOMER`. |
| `INSPIRATION` | nur Site-Admins | Lern-/Style-Korpus für Creative Generation — **nie** 1:1, **nie** Meta-Launch |

Alle drei liegen in `public.brand_assets` (`library_scope`). Bytes im privaten Bucket `creative-assets`.

## Isolation (nicht verhandelbar)

- Authenticated RLS: `brand_assets_select_own` nur `library_scope = 'CUSTOMER'` **und** `user_id = auth.uid()`.
- Preview (`/api/media-library/preview`): Kunden nur eigene `CUSTOMER`-Zeilen. Admins zusätzlich `INSPIRATION` und `PLATFORM`. **Kein** Admin-Preview fremder Kundenassets.
- Executor / Format-Optimizer / Launch: ausschließlich `library_scope = 'CUSTOMER'`.
- `PLATFORM`- und `INSPIRATION`-Zeilen haben kein `platform_account_id` / kein `meta_image_hash`.
- 1:1 aus der Motivbibliothek: `clonePlatformMotifForCustomer` schreibt eine **neue** `CUSTOMER`-Zeile unter dem Zielkunden (`adopted_from_platform_asset_id` in metadata). Der Shared-Row bleibt unangetastet.
- Kunden A sieht, startet und launched niemals Assets von Kunden B — auch nicht über Style-Refs: Customer-Refs müssen `user_id` + `platform_account_id` matchen.

## Asset-Rollen (`asset_role`)

| Rolle | Bedeutung |
|---|---|
| `LOCKED_PHOTO` | Muss unverändert bleiben; nur Embed in Compose. Nur `CUSTOMER`. |
| `UPLOAD_EDITABLE` | Normaler Kunden-Upload (Default) **und** PLATFORM-Motive. |
| `GENERATED` | KI-Ausgabe (`source_type = GENERATED`). |
| `STYLE_REFERENCE` | Style-/Inspirationsreferenz. Inspiration-Vault-Zeilen sind immer diese Rolle. |

## Training-Status (`training_status`)

| Status | Bedeutung |
|---|---|
| `none` | Default |
| `marked_good` | Kunde markiert als gutes Beispiel (RPC `mark_brand_asset_training_status`) |
| `performance_winner` | System-Label (Phase 2+); nicht vom Kunden gesetzt |

Kunden dürfen nur `marked_good` setzen oder auf `none` zurücksetzen — und nur für eigene `CUSTOMER`-Assets.

## Kundenbibliothek (`CUSTOMER`)

1. UI: `/dashboard/creatives`
2. API: `POST /api/meta/automation/asset-upload` (multipart `file`; `brandProfileId` optional)
3. RPC: `register_uploaded_brand_asset` → `source_type=UPLOADED`, `asset_role=UPLOAD_EDITABLE`, `READY`/`APPROVED`
4. Brand-Profil ist **kein** Upload-Gate. Ohne Profil wird das Asset unbound gespeichert und beim Active Launch über `bind_unbound_customer_brand_asset_for_launch` an das Launch-Profil gebunden.
5. Danach im Automation Control Center als Brand-Asset wählbar
6. Phase 4 UI: Stern → `mark_brand_asset_training_status`; Schloss → `set_brand_asset_locked_photo_role`; Abschnitt „KI-Creative erzeugen“ → enqueue
7. Adbot darf Kundenmotive 1:1 oder angepasst verwenden — nur innerhalb desselben `user_id`.

SQL-Nachzug:
- `supabase/migrations/20260809193000_media_library_upload_without_brand_profile.sql`
- `supabase/migrations/20260809194500_fix_library_scope_trigger_short_circuit.sql` (Pflicht: verhindert `record "new" has no field "library_scope"` beim Beitrag-Push)
- `supabase/migrations/20260818230000_creative_generation_phase1_contract.sql` (Rollen, Training-Status, Generation-Contract)
- `supabase/migrations/20260923140000_creative_library_global.sql` (unbound customer library)

## Adbot-Motivbibliothek (`PLATFORM`)

1. UI: `/dashboard/motifs` (Site-Admin)
2. API: `/api/admin/platform-library` (`GET` Liste, `POST` Upload + Tags, `PATCH` Tags/Kurzinfo/`recaption`, `DELETE` revoke)
3. RPC: `register_platform_library_asset` / `update_platform_library_asset_metadata` (prüft `site_admins`)
4. Storage-Pfad: `platform/{sha2}/{sha}.{ext}` — content-addressed, kein Kundenprefix
5. Nach Upload: Vision-Kurzinfo (OpenRouter, `PLATFORM_LIBRARY_CAPTION_MODEL` oder `openai/gpt-4o-mini`) in `metadata.content_summary`
6. Tags in `metadata.tags` (`normalizeCreativeTags`, max. 12×40)
7. Generation: passende Motive werden als Style-Refs angehängt (`attachPlatformMotifStyleRefs`). Bei starkem Tag-Match (`score >= 6`) darf Adbot 1:1 clonen statt nur anregen.
8. Hard Guards: RLS, Executor-Filter `CUSTOMER`, Tenant-Trigger early-return für `PLATFORM` analog `INSPIRATION`

## Inspiration Vault (`INSPIRATION`)

1. UI: `/dashboard/inspiration` (Site-Admin)
2. API: `POST /api/admin/inspiration-vault/upload`
3. RPC: `register_inspiration_vault_asset` (prüft `site_admins`) → `asset_role=STYLE_REFERENCE`
4. Hard Guards: RLS, Executor-Filter, Trigger auf `mutation_plans` / `mutation_plan_steps`
5. Phase-1-Generation: Vault-IDs dürfen als `reference_asset_ids` (Style-Korpus) im Contract vorkommen — **kein** 1:1-Copy, **kein** Live-Launch

## Customer SELECT-Spalten

Authenticated erhält column-level `GRANT SELECT` u. a. für `asset_role`, `training_status`, `marked_good_at`, `marked_good_by`, `style_notes`. Die TypeScript-Liste `CUSTOMER_BRAND_ASSET_LIST_COLUMNS` / `MEDIA_LIBRARY_ASSET_LIST_SELECT` muss mit den Grants übereinstimmen — fehlende Grants lassen die Creatives-UI leer wirken.

## SQL

Migrationen:
- `supabase/migrations/20260809190000_media_library_and_inspiration_vault.sql`
- `supabase/migrations/20260818230000_creative_generation_phase1_contract.sql`
- `supabase/migrations/20260923170000_platform_motif_library.sql`

Die PLATFORM-Migration rührt **nicht** an `materialize_meta_organic_boost_plan`, `get_effective_meta_kill_switch` oder Launch-Prepare.
