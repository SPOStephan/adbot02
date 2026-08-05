# Verbindliche Asset-Auswahl im Meta-Onboarding

Stand: 5. August 2026

## Vertrag

Im Facebook-Login-for-Business-Dialog wählt der Kunde Seiten, Instagram-Konten und Werbekonten. Adbot übernimmt **alle und ausschließlich** die dort ausgewählten Assets. Meta liefert dafür zwei technisch unterschiedliche, ausdrücklich getrennte Formen: granulare Ziel-IDs oder ein bereits auf die Dialogauswahl begrenztes Business-Integration-System-User-Token.[1][2]

| Modus | Erkennung | Verbindliche Asset-Quelle |
| --- | --- | --- |
| Granulare Auswahl | Mindestens ein `debug_token.granular_scopes[].target_ids`-Eintrag enthält IDs | Nur die granularen Ziel-IDs; leere Kategorien bleiben fail-closed |
| Business-System-User-Auswahl | Token-Typ ist exakt `BUSINESS_INTEGRATION_SYSTEM_USER`, `granular_scopes` ist vorhanden und **alle** `target_ids` sind leer | Nur die mit diesem asset-begrenzten Token über `/me/accounts` und `/me/adaccounts` sichtbaren Assets; Instagram zusätzlich nur nach direkter Profil-Verifikation |

Sobald Meta mindestens eine granulare Ziel-ID liefert, ist der Business-System-User-Fallback vollständig deaktiviert. Damit kann eine teilweise granulare Antwort niemals unbeabsichtigt auf weitere token-sichtbare Assets erweitert werden.

## Granularer Modus

| Asset | Quelle |
| --- | --- |
| Instagram | ausschließlich `instagram_basic.target_ids` |
| Werbekonto | ausschließlich `ads_read`- oder `ads_management.target_ids`, normalisiert mit oder ohne `act_` |
| Facebook-Seite | Page-Scope-`target_ids`; fehlen nur diese, werden ausschließlich Seiten mit Link zu einer bereits granular gewählten Instagram-ID aufgelöst |

Fehlen in diesem Modus die erforderlichen Instagram-, Werbekonto- oder Seiten-Ziel-IDs, bricht der Callback mit `missing_instagram_targets`, `missing_ad_account_targets` beziehungsweise `missing_page_targets` ab. Werbekonten werden niemals aus Seiten, `promote_pages` oder einem vermeintlich eindeutigen sichtbaren Konto abgeleitet.

## Business-Integration-System-User-Modus

Meta dokumentiert, dass der Kunde beim Login for Business den Zugriff auf bestimmte Assets delegiert und die App mit einem Business Integration System User Access Token nur auf diese bezeichneten Assets zugreifen kann.[1] In diesem eng erkannten Modus übernimmt Adbot alle über `/me/accounts` sichtbaren Seiten und alle über `/me/adaccounts` sichtbaren Werbekonten.

Instagram-IDs aus `page.instagram_business_account` sind dabei **nur Kandidaten**. Jeder Kandidat muss zusätzlich über `/{instagram-id}?fields=id,name,username` mit demselben Business-System-User-Token direkt lesbar sein. Meta-Fehler 10, 100 oder 200 bedeuten, dass das Profil nicht delegiert beziehungsweise nicht zugänglich ist; der Kandidat wird verworfen. Dadurch erscheint ein lediglich mit einer ausgewählten Seite verknüpftes, aber im Meta-Dialog nicht freigegebenes Instagram-Konto nicht in Adbot.

Der Callback speichert die Verbindung nur, wenn mindestens eine Seite, mindestens ein direkt verifiziertes Instagram-Konto und mindestens ein Werbekonto aufgelöst wurden. Andernfalls bleibt der Vorgang fail-closed.

## Verbotene Auflösungen

| Verbot | Grund |
| --- | --- |
| Direkte Tokenlisten bei normalen oder teilweise granularen Tokens | Würde über die Dialogauswahl hinaus erweitern |
| Instagram ungeprüft aus `page.instagram_business_account` übernehmen | Seitenverknüpfung ist keine Instagram-Freigabe |
| Werbekonten aus Seitenverknüpfungen oder Eindeutigkeitsheuristiken ableiten | Nicht autoritativ |
| Adbot-interne Zweitauswahl oder Bestätigungs-UI einführen | Der Meta-Dialog bleibt die alleinige Auswahloberfläche |

## Parsing

`target_ids` können Zahlen, Digit-Strings oder `act_<digits>` sein. Große Meta-IDs werden vor `JSON.parse` geschützt, damit keine Präzision verloren geht.

[1]: https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business
[2]: https://developers.facebook.com/docs/graph-api/reference/debug_token/
