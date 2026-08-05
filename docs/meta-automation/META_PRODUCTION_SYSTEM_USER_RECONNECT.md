# Production-Reconnect mit Meta-System-User-Token

**Stand: 4. August 2026.** Dieses Dokument beschreibt den Production-Vertrag für Facebook Login for Business auf `app.adbot.one`. Die separat erforderliche Instagram-Auswahl ist durch zwei erfolgreiche Staging-OAuth-Screenshots vom 30. Juli 2026 belegt.

## Zielzustand der Login-Konfiguration

Die Production-Konfiguration muss den erfolgreichen Staging-Flow reproduzieren. Im Meta-Dialog wählen Kundinnen und Kunden das Business-Portfolio, die Facebook-Seite, das Werbekonto und das Instagram-Konto ausdrücklich aus. Eine Konfiguration, die nur Portfolio, Seite und Werbekonto anbietet, entspricht nicht dem abgenommenen Staging-Onboarding.

| Einstellung | Zielzustand gemäß erfolgreichem Staging |
| --- | --- |
| Tokentyp | Business Integration System User Access Token |
| Facebook-Seite erforderlich | aus |
| Werbekonto erforderlich | an |
| Werbekonto-Asset-Tasks | `MANAGE`, `ADVERTISE`, `ANALYZE`, `DRAFT` |
| OAuth-Permissions | `ads_read`, `ads_management`, `instagram_basic`, `pages_read_engagement`, `pages_show_list` |
| Kundenauswahl im Dialog | Business-Portfolio, Facebook-Seite, Werbekonto und Instagram-Konto |

Die Production-Variable `META_LOGIN_CONFIG_ID` darf ausschließlich auf die nach diesem Vertrag gespeicherte Production-Konfiguration der Meta-App `1399593778714605` verweisen. Eine neue Konfiguration erhält eine neue ID und erfordert deshalb eine Aktualisierung der Vercel-Production-Variable sowie ein anschließendes Redeployment.

## Scope-Validierung

Der Callback verlangt weiterhin alle fünf funktionalen Adbot-Scopes. Metas System-User-Flow kann zusätzlich `public_profile`, `business_management`, `pages_manage_ads` und `pages_manage_metadata` liefern. Diese bekannten Kompatibilitätsscopes werden toleriert, aber nicht als freigegebene Adbot-Produktfunktion in `platform_accounts.meta_scopes` geführt. Jede andere unbekannte Zusatzberechtigung sowie jeder fehlende Kernscope führt weiterhin fail-closed zu `scope_validation`.

| Kategorie | Scopes | Callback-Verhalten |
| --- | --- | --- |
| Funktionaler Adbot-Vertrag | `ads_read`, `ads_management`, `instagram_basic`, `pages_read_engagement`, `pages_show_list` | Alle fünf sind Pflicht und werden persistiert. |
| Meta-Automatik | `public_profile` | Wird toleriert, aber nicht als funktionaler Adbot-Scope gespeichert. |
| Bekannte System-User-Kompatibilität | `business_management`, `pages_manage_ads`, `pages_manage_metadata` | Wird toleriert und protokolliert, erweitert aber keinen Anwendungspfad. |
| Andere Zusatzrechte | jede nicht ausdrücklich bekannte Permission | Der Callback bricht mit `scope_validation` ab. |

Meta beschreibt Business Integration System User Access Tokens als Tokentyp für kontinuierliche automatisierte Aktionen und den automatisierten Abruf von Ads Insights. Der Flow verwendet den Authorization-Code-Grant; die Adbot-Start-Route setzt deshalb `response_type=code` und übergibt die Production-`config_id`.[1]

Nach dem Code-Austausch versucht Adbot eine Token-Verlängerung. Für System-User-Tokens wird `set_token_expires_in_60_days=true` verwendet. Lehnt Meta den klassischen User-Austausch ab, bleibt das aus dem Code-Austausch stammende gültige Token erhalten — der Callback darf daran nicht mehr mit generischem `callback` scheitern.

## Production-Abnahme

Der Reconnect gilt erst als erfolgreich, wenn der Meta-Dialog alle vier Asset-Kategorien anbietet und die vorgesehenen Assets ausgewählt wurden. Für PHDL sind dies das Portfolio `PHDL`, die Seite `Seehotel Fährhaus`, das Werbekonto `PHDL 1` und das Instagram-Konto `seehotel_faehrhaus`.

Nach dem Callback muss das Dashboard `Meta wurde erfolgreich verbunden` anzeigen. Die Datenbank muss eine aktive Connectorzeile mit `revoked_at = null`, den fünf funktionalen `meta_scopes` und mindestens je einem Asset der Typen `facebook_page`, `instagram_account` und `ad_account` enthalten. Danach muss der erste manuelle Read-Sync ohne Mutation abschließen. Kundenpolicy und Kill-Switch werden durch den Reconnect nicht automatisch aktiviert.

## Regressionstests

`npm run test:meta-scope-policy` prüft den konkreten Production-System-User-Fall sowie die weiterhin fail-closed behandelten Fälle eines fehlenden `ads_management`-Scopes und einer unbekannten Permission. `npm run test:dashboard-meta-connector` prüft die Callback-Verdrahtung und den sichtbaren Hinweis zur separaten Instagram-Auswahl. Beide Tests sind Bestandteil von `npm run test:meta-all`.

## References

[1]: https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business "Meta for Developers – Facebook Login for Business"
