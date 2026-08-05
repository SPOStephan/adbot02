# Verbindliche Asset-Auswahl im Meta-Onboarding

Stand: 5. August 2026

## Vertrag

Im Facebook-Login-for-Business-Dialog wählt der Kunde Assets. Meta bestätigt die Auswahl in `debug_token.granular_scopes[].target_ids` — jede Ziel-ID ist die kanonische Asset-ID.[1]

Adbot speichert **ausschließlich** diese IDs:

| Asset | Scopes für Ziel-IDs |
| --- | --- |
| Facebook-Seite | `pages_show_list`, `pages_read_engagement` |
| Werbekonto | `ads_read`, `ads_management` |
| Instagram | `instagram_basic` |

## Was verboten ist

- `/me/accounts` oder `/me/adaccounts` **ohne** Ziel-ID-Filter als Auswahl zu behandeln (System-User-Tokens können ältere Zuweisungen noch listen)
- Instagram aus `page.instagram_business_account` abzuleiten
- Adbot-interne Zweitauswahl / Bestätigungs-UI als Ersatz für den Meta-Dialog

Fehlt eine Ziel-ID-Menge → Callback mit `missing_page_targets` / `missing_ad_account_targets` / `missing_instagram_targets`. Sind IDs da, aber nicht lesbar → `no_assets`.

## Parsing

`target_ids` können Zahlen oder Strings sein; große IDs werden vor `JSON.parse` geschützt.

## Quellen

[1]: https://developers.facebook.com/docs/graph-api/reference/debug_token/
