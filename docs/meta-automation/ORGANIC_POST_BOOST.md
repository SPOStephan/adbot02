# Organic Post Boost (Beitrag-Push)

**Stand:** 3. August 2026  
**Scope:** Meta Facebook page posts (Phase 1); Instagram detection + overrides only

## Ziel

Neue organische Beiträge automatisch erkennen und mit kundendefinierten Standards
(Laufzeit in Tagen, Tages- oder Laufzeitbudget, optionaler CTA) als Engagement-Kampagne
bewerben – ohne neue Werbemittel, über `object_story_id`.

## Multi-Tenant

Alle Tabellen und RPCs sind an `(user_id, platform_account_id)` gebunden. RLS erlaubt
Browserrollen nur SELECT auf eigene Zeilen; Mutationen laufen ausschließlich über
service-role RPCs nach Dashboard-Auth.

## Komponenten

| Baustein | Zweck |
|---|---|
| `meta_boost_settings` | Versionierte Konto-Standards |
| `meta_content_boost_overrides` | Pro-Beitrag Budget/Laufzeit/CTA/SKIP |
| `meta_organic_boost_links` | Dedup: ein Plan pro Kandidat |
| `run_meta_organic_boost_planner` | Nach Sync: neue Kandidaten → Pläne |
| `materialize_meta_organic_boost_plan` | LAUNCH_CHAIN ohne Image-Upload |
| `/api/meta/automation/boost-*` | Kunden-APIs |

## Live-Testablauf

1. Meta mit `ads_management` verbunden, EUR-Konto, aktiver Sync
2. Policy mit `allow_new_launches` aktiv
3. Kill-Switch `FREEZE_WRITES`
4. Beitrag-Push-Standards speichern (manuelle Freigabe an)
5. Optional Auto-Boost aktivieren → nächster Sync plant neue Facebook-Beiträge
6. Im Dashboard Boost vorbereiten → „BEITRAG BEWERBEN“ freigeben
7. Executor schreibt die Kette zu Meta und reconciliert

## Grenzen Phase 1

- Instagram-Media-IDs sind keine `page_post`-Story-IDs → kein Auto-Boost
- CTA optional; Meta `validate_only` kann CTA+`object_story_id` je Posttyp ablehnen
- Lifetime-Budget erfordert Canary/manuelle Freigabe
