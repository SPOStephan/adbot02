# Verbindliche Asset-Auswahl im Meta-Onboarding

Stand: 5. August 2026

## Vertrag

Im Facebook-Login-for-Business-Dialog wählt der Kunde Assets. Meta bestätigt die Auswahl in `debug_token.granular_scopes[].target_ids` — jede Ziel-ID ist die kanonische Asset-ID.[1]

| Asset | Quelle |
| --- | --- |
| Instagram | nur `instagram_basic` `target_ids` |
| Werbekonto | nur `ads_read` / `ads_management` `target_ids` (auch `act_<id>`) |
| Facebook-Seite | Page-Scope-`target_ids`; fehlen sie, Seiten mit Link zur gewählten Instagram-ID |

**Kein Raten:** Ein Werbekonto wird niemals aus einer Seite, `promote_pages` oder „einzigem sichtbaren Konto“ abgeleitet.

## Seiten ohne `target_ids`

Meta dokumentiert: wenn eine Permission „für alle“ gilt, fehlen `target_ids`.[1] Bei System-User-Tokens passiert das häufig für Pages.

Dann: Instagram-`target_ids` müssen vorhanden sein → `/me/accounts` → nur Seiten, deren `instagram_business_account.id` in den IG-`target_ids` liegt. Ohne Treffer → `missing_page_targets`.

## Werbekonten ohne `target_ids`

Fehlen `ads_*` `target_ids` → `missing_ad_account_targets`. Ursache liegt bei Meta/Login-Config (Token liefert die Dialog-Auswahl nicht als Ziel-IDs), nicht bei Adbot-Heuristik.

## Was verboten ist

- `/me/accounts` oder `/me/adaccounts` **ohne** Filter als Auswahl zu behandeln
- Instagram aus `page.instagram_business_account` abzuleiten, wenn Meta keine IG-`target_ids` liefert
- Werbekonten aus Seitenverknüpfungen abzuleiten
- Adbot-interne Zweitauswahl / Bestätigungs-UI

## Parsing

`target_ids` können Zahlen, Digit-Strings oder `act_<digits>` sein; große IDs werden vor `JSON.parse` geschützt.

## Quellen

[1]: https://developers.facebook.com/docs/graph-api/reference/debug_token/
