# Verbindliche Asset-Auswahl im Meta-Onboarding

Stand: 5. August 2026

## Vertrag

Im Facebook-Login-for-Business-Dialog wählt der Kunde Assets. Meta bestätigt die Auswahl in `debug_token.granular_scopes[].target_ids` — jede Ziel-ID ist die kanonische Asset-ID.[1]

| Asset | Quelle |
| --- | --- |
| Instagram | nur `instagram_basic` `target_ids` |
| Werbekonto | `ads_read` / `ads_management` `target_ids` |
| Facebook-Seite | `pages_show_list` / `pages_read_engagement` / `pages_manage_ads` / `pages_manage_metadata` `target_ids` |

## Seiten ohne `target_ids`

Meta dokumentiert: wenn eine Permission „für alle“ gilt, fehlen `target_ids`.[1] Bei System-User-Tokens passiert das häufig für Pages (`Facebook-Seite erforderlich: aus` in der Login-Config).

Dann leitet Adbot Seiten **nur** so ab:

1. Instagram-`target_ids` müssen vorhanden sein
2. `/me/accounts` wird gelesen
3. Es bleiben **ausschließlich** Seiten, deren `instagram_business_account.id` in den Instagram-`target_ids` liegt

Das ist kein Erfinden von Instagram aus Seiten — sondern Filtern der Seiten anhand der gewählten Instagram-IDs. Ohne Treffer → `missing_page_targets`.

## Was verboten ist

- `/me/accounts` oder `/me/adaccounts` **ohne** Filter als Auswahl zu behandeln
- Instagram aus `page.instagram_business_account` abzuleiten, wenn Meta keine IG-`target_ids` liefert
- Adbot-interne Zweitauswahl / Bestätigungs-UI

Fehlt Ads- oder Instagram-Ziel-ID → `missing_ad_account_targets` / `missing_instagram_targets`. Sind IDs da, aber nicht lesbar → `no_assets`.

## Parsing

`target_ids` können Zahlen oder Strings sein; große IDs werden vor `JSON.parse` geschützt.

## Quellen

[1]: https://developers.facebook.com/docs/graph-api/reference/debug_token/
