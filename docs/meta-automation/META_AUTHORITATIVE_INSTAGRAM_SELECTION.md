# Verbindliche Asset-Auswahl im Meta-Onboarding

Stand: 6. August 2026

## Vertrag

Im Facebook-Login-for-Business-Dialog wählt der Kunde Seiten, Instagram-Konten und Werbekonten. Adbot übernimmt **alle und ausschließlich** die dort ausgewählten Assets. Meta liefert dafür zwei technisch unterschiedliche, ausdrücklich getrennte Formen: granulare Ziel-IDs oder ein bereits auf die Dialogauswahl begrenztes Business-Integration-System-User-Token.[1][2]

| Modus | Erkennung | Verbindliche Asset-Quelle |
| --- | --- | --- |
| Granulare Auswahl | Mindestens ein `debug_token.granular_scopes[].target_ids`-Eintrag enthält IDs | Nur die granularen Ziel-IDs; leere Kategorien bleiben fail-closed |
| Business-System-User-Auswahl | Meta klassifiziert den Token als System User (`SYSTEM_USER`, `SYSTEM-USER` oder eine `SYSTEM_USER`-Variante), `granular_scopes` ist vorhanden, **alle** `target_ids` sind leer und der signierte OAuth-State bestätigt einen unmittelbar zuvor erfolgreichen Vollwiderruf | `/me/accounts` + `/me/adaccounts` nach frischem Widerruf; Instagram über die auf diesen Seiten verknüpften Business-Konten |

Sobald Meta mindestens eine granulare Ziel-ID liefert, ist der Business-System-User-Fallback vollständig deaktiviert. Damit kann eine teilweise granulare Antwort niemals unbeabsichtigt auf weitere token-sichtbare Assets erweitert werden.

## Granularer Modus

| Asset | Quelle |
| --- | --- |
| Instagram | ausschließlich `instagram_basic.target_ids` |
| Werbekonto | ausschließlich `ads_read`- oder `ads_management.target_ids`, normalisiert mit oder ohne `act_` |
| Facebook-Seite | Page-Scope-`target_ids`; fehlen nur diese, werden ausschließlich Seiten mit Link zu einer bereits granular gewählten Instagram-ID aufgelöst |

Fehlen in diesem Modus die erforderlichen Instagram-, Werbekonto- oder Seiten-Ziel-IDs, bricht der Callback mit `missing_instagram_targets`, `missing_ad_account_targets` beziehungsweise `missing_page_targets` ab. Werbekonten werden niemals aus Seiten, `promote_pages` oder einem vermeintlich eindeutigen sichtbaren Konto abgeleitet.

## Business-Integration-System-User-Modus

Production zeigte, dass die dokumentierten Edges `assigned_pages` / `assigned_instagram_accounts` / `assigned_ad_accounts` für Login-for-Business-System-User mit Graph Code 100 scheitern (auch parameterlos).[3][4][5] Nach nachgewiesenem Vollwiderruf ist das Token bereits auf die Dialogauswahl begrenzt; Adbot liest deshalb `/me/accounts` und `/me/adaccounts` und übernimmt Instagram-Konten, die an genau diesen Seiten hängen.

Bevor dieser Modus aktiviert werden darf, muss Adbot die vorherige App-Autorisierung über `DELETE /{user-id}/permissions` erfolgreich widerrufen, die lokal gespeicherten Tokens und Asset-IDs löschen und diesen Erfolg im signierten, kurzlebigen OAuth-State festhalten.[6] Ein System-User-Token ohne diesen Resetnachweis wird sofort widerrufen und in einen neuen Meta-Dialog umgeleitet; es wird nichts gespeichert.

Der Callback speichert die Verbindung nur, wenn mindestens eine Seite, ein Instagram-Konto und ein Werbekonto aus dieser frischen Token-Sicht aufgelöst wurden. Andernfalls bleibt der Vorgang fail-closed.

## Verbotene Auflösungen

| Verbot | Grund |
| --- | --- |
| Direkte Tokenlisten bei normalen oder teilweise granularen Tokens | Würde über die Dialogauswahl hinaus erweitern |
| `/me/accounts` oder `/me/adaccounts` ohne signierten Vollwiderruf als Dialogauswahl | Kann ältere oder anderweitig token-sichtbare Zuweisungen enthalten |
| Instagram aus `page.instagram_business_account` im **granularen** Modus | Dort sind nur `instagram_basic` `target_ids` autoritativ |
| System-User-Direktmodus ohne signierten Vollwiderrufsnachweis | Kann eine bestehende Business-Integration samt Altzuweisungen wiederverwenden |
| Werbekonten aus Seitenverknüpfungen oder Eindeutigkeitsheuristiken ableiten | Nicht autoritativ |
| Adbot-interne Zweitauswahl oder Bestätigungs-UI einführen | Der Meta-Dialog bleibt die alleinige Auswahloberfläche |

## Parsing

`target_ids` können Zahlen, Digit-Strings oder `act_<digits>` sein. Große Meta-IDs werden vor `JSON.parse` geschützt, damit keine Präzision verloren geht.

[1]: https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business
[2]: https://developers.facebook.com/docs/graph-api/reference/debug_token/
[3]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/system-user/assigned_pages
[4]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/system-user/assigned_instagram_accounts
[5]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/system-user/assigned_ad_accounts
[6]: https://developers.facebook.com/documentation/facebook-login/guides/permissions/request-revoke
