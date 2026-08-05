# Verbindliche Asset-Auswahl im Meta-Onboarding

Stand: 5. August 2026

## Vertrag

Im Facebook-Login-for-Business-Dialog wählt der Kunde Assets. Meta bestätigt die Auswahl in `debug_token.granular_scopes[].target_ids` — jede Ziel-ID ist die kanonische Asset-ID.[1]

| Asset | Quelle |
| --- | --- |
| Instagram | nur `instagram_basic` `target_ids` |
| Facebook-Seite | Page-Scope-`target_ids`, sonst Seiten mit Link zur gewählten Instagram-ID |
| Werbekonto | `ads_*` `target_ids` (auch `act_<id>`), sonst eindeutig über `promote_pages` der gewählten Seite (oder einziges sichtbares Werbekonto) |

## Seiten / Werbekonten ohne `target_ids`

Meta dokumentiert: wenn eine Permission „für alle“ gilt, fehlen `target_ids`.[1] Bei System-User-Tokens passiert das häufig.

**Seiten:** Instagram-`target_ids` müssen vorhanden sein → `/me/accounts` → nur Seiten, deren `instagram_business_account.id` in den IG-`target_ids` liegt.

**Werbekonten:** gewählte Seiten-IDs → `/me/adaccounts` + `/{ad-account}/promote_pages` → nur das Werbekonto, das genau eine der gewählten Seiten bewerben kann. Mehrere Treffer oder keiner (bei mehreren Konten) → `missing_ad_account_targets`. Ein einziges sichtbares Werbekonto ohne Page-Match → dieses Unique-Konto.

Das ist kein Erfinden von Instagram aus Seiten — und kein Fall-Open auf alle Pages/Ads.

## Was verboten ist

- `/me/accounts` oder `/me/adaccounts` **ohne** Filter als Auswahl zu behandeln
- Instagram aus `page.instagram_business_account` abzuleiten, wenn Meta keine IG-`target_ids` liefert
- Adbot-interne Zweitauswahl / Bestätigungs-UI

Fehlt Ads- oder Instagram-Ziel-ID → `missing_ad_account_targets` / `missing_instagram_targets`. Sind IDs da, aber nicht lesbar → `no_assets`.

## Parsing

`target_ids` können Zahlen oder Strings sein; große IDs werden vor `JSON.parse` geschützt.

## Quellen

[1]: https://developers.facebook.com/docs/graph-api/reference/debug_token/
