# Organic Post Boost (Beitrag-Push)

**Stand:** 4. August 2026  
**Scope:** Meta Facebook-Seitenbeiträge und Instagram-Medien (an eine Page gekoppelt)

## Kundenmodi (Auswahl)

| Modus | Verhalten |
|---|---|
| `OFF` | Beiträge werden erkannt, aber nicht beworben |
| `REVIEW` | Neue Beiträge werden als Boost-Plan vorbereitet; Kunde gibt jeden Beitrag einzeln frei (`BEITRAG BEWERBEN`) |
| `AUTO` | Jeder neue Beitrag (laut Quellenfilter) wird mit Tagesbudget × Laufzeit automatisch beworben |

Standard-Werbeziel in beiden aktiven Modi: **Interaktionen/Likes**  
(`OUTCOME_ENGAGEMENT` / Optimierung `POST_ENGAGEMENT`).

`AUTO` verlangt ein **Tagesbudget** plus **Laufzeit in Tagen** (Start/Ende am Ad Set).

## Quellenfilter (Auswahl)

| Filter | Verhalten |
|---|---|
| `facebook` | Nur Facebook-Seitenbeiträge (`object_story_id`) |
| `instagram` | Nur Instagram-Medien (`source_instagram_media_id` + Page + IG-User) |
| `both` | Beides |

Instagram-Boost setzt voraus, dass das IG-Konto als Business-Account an eine Facebook-Page gekoppelt ist (`parent_meta_asset_id`).

## Multi-Tenant

Alle Tabellen/RPCs sind an `(user_id, platform_account_id)` gebunden. Neue Konten erhalten dieselben Modi isoliert.

## Live-Test

Siehe `ORGANIC_POST_BOOST_LIVE_TEST.md`.

## Migrationen

1. `20260803180000_meta_organic_post_boost.sql`
2. `20260803180100_meta_organic_boost_materializer.sql`
3. `20260804090000_meta_boost_mode_selection.sql`
4. `20260804100000_meta_organic_boost_instagram.sql`

## Grenzen

- Optionaler CTA kann von Meta je Posttyp per `validate_only` abgelehnt werden
- Boost nutzt den organischen Beitrag selbst — keine neuen Creatives/Assets
