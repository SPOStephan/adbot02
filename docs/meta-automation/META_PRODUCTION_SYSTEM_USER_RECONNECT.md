# Production-Reconnect mit Meta-System-User-Token

**Stand: 4. August 2026.** Dieses Dokument beschreibt den Production-Vertrag für Facebook Login for Business auf `app.adbot.one`.

## Fehlerbild und Ursache

Der Production-System-User-Token enthält neben Adbots fünf funktionalen Kernscopes drei zusätzliche, von der konkreten Meta-System-User-Konfiguration gewährte Berechtigungen:

| Kategorie | Scopes | Callback-Verhalten |
| --- | --- | --- |
| Funktionaler Adbot-Vertrag | `ads_read`, `ads_management`, `instagram_basic`, `pages_read_engagement`, `pages_show_list` | Alle fünf müssen vorhanden sein und werden als `meta_scopes` persistiert. |
| Meta-Automatik | `public_profile` | Wird toleriert, aber nicht als funktionaler Adbot-Scope gespeichert. |
| Bekannte System-User-Kompatibilität | `business_management`, `pages_manage_ads`, `pages_manage_metadata` | Wird für diese Production-Konfiguration toleriert und protokolliert, aber nicht als funktionaler Adbot-Scope gespeichert. |
| Andere Zusatzrechte | jede nicht ausdrücklich bekannte Permission | Der Callback bricht weiterhin fail-closed mit `scope_validation` ab. |

Damit bleibt die Sicherheitsgrenze eng: Der Token muss die vollständige Adbot-Minimalmenge enthalten; eine fehlende Kernberechtigung oder eine neue unbekannte Zusatzberechtigung verhindert die Verbindung weiterhin. Adbot verwendet in seinen implementierten Pfaden ausschließlich die explizit programmierten Graph-Endpunkte. Die drei Kompatibilitätsscopes erweitern keine Anwendungspfade und werden nicht in `platform_accounts.meta_scopes` als freigegebene Produktfunktion geführt.

Meta beschreibt Business Integration System User Access Tokens als passenden Tokentyp für kontinuierliche automatisierte Aktionen und den automatisierten Abruf von Ads Insights. Der Flow verwendet ausschließlich den Authorization-Code-Grant. Die bestehende Adbot-Start-Route setzt deshalb weiterhin `response_type=code` und übergibt die Production-`config_id`.[1]

## Instagram-Auswahl im Login-Dialog

Der Facebook-Login-for-Business-Dialog zeigt das Business-Portfolio, eine Facebook-Seite und ein Werbekonto. Ein separates Instagram-Auswahlfeld ist für diesen Flow nicht erforderlich. Adbot ruft nach dem Tokenaustausch `/me/accounts` ab und liest für die ausgewählte Seite das Feld `instagram_business_account{id,name,username}`. Das Instagram-Business-Profil muss daher in Meta mit der ausgewählten Facebook-Seite verknüpft sein.

Der Callback verlangt danach mindestens eine zulässige Facebook-Seite, ein darüber gefundenes Instagram-Business-Profil und ein zulässiges Werbekonto. Fehlt eines davon, endet der Reconnect mit `no_assets`, ohne einen unvollständigen Connector zu speichern.

## Production-Verifikation

1. Die Vercel-Production-Variable `META_LOGIN_CONFIG_ID` verweist ausschließlich auf die Production-Konfiguration der Meta-App `1399593778714605`.
2. Im Meta-Dialog werden das Business-Portfolio `PHDL`, die Seite `Seehotel Fährhaus` und das vorgesehene Werbekonto ausgewählt.
3. Das Fehlen einer separaten Instagram-Auswahl ist erwartetes Verhalten. Das Instagram-Profil wird serverseitig über die Seite ermittelt.
4. Nach erfolgreichem Callback zeigt das Dashboard `Meta wurde erfolgreich verbunden` und anschließend die gespeicherten Facebook-, Instagram- und Werbekonto-Assets.
5. Die Datenbank muss eine aktive Connectorzeile mit `revoked_at = null`, den fünf funktionalen `meta_scopes` und mindestens je einem Asset der Typen `facebook_page`, `instagram_account` und `ad_account` enthalten.
6. Der erste manuelle Read-Sync muss ohne Mutation abschließen. Kundenpolicy und Kill-Switch werden durch den Reconnect nicht automatisch aktiviert.

## Regressionstests

`npm run test:meta-scope-policy` prüft den konkreten Production-System-User-Fall sowie die weiterhin fail-closed behandelten Fälle `ads_management` fehlt und unbekannte Permission vorhanden. `npm run test:dashboard-meta-connector` prüft die Callback-Verdrahtung und den sichtbaren Instagram-Hinweis. Beide Tests sind Bestandteil von `npm run test:meta-all`.

## References

[1]: https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business "Meta for Developers – Facebook Login for Business"
[2]: https://developers.facebook.com/documentation/pages-api/manage-pages "Meta for Developers – Manage a Page"
