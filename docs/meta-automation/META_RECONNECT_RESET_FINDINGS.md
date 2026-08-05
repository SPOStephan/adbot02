# Meta-Reconnect-Reset: verifizierte Grundlage

Stand: 2026-08-05

## Production-Befund

Der aktuelle Adbot-Endpunkt `POST /api/connectors/meta/disconnect` setzt ausschließlich lokale Felder in `platform_accounts` zurück (`revoked_at`, Tokenfelder und Syncstatus). Er sendet **keinen** Widerruf an Meta. Deshalb bleiben die Meta-Business-Integration und deren System-User-Assetzuweisungen bestehen. Beim nächsten Login kann Meta denselben System User mitsamt älteren Zuweisungen wiederverwenden.

Der aktuell deployed Business-System-User-Fallback behandelt alle über `GET /me/accounts` sichtbaren Seiten als aktuelle Dialogauswahl. Dadurch wurden die ältere Seite „Bon-Kredit“ und deren verknüpftes Instagram-Profil übernommen, obwohl im aktuellen Dialog „Boncred“ gewählt war.

## Offizieller Widerrufsvertrag

Meta dokumentiert für den vollständigen App-Widerruf:

- `DELETE /{user-id}/permissions`
- Aufruf mit gültigem User-Access-Token oder App-Access-Token der aktuellen App
- Bei Erfolg werden User-Access-Tokens invalidiert.
- Beim nächsten Login muss der Nutzer die App wie beim ersten Login erneut autorisieren.

Quellen:

1. https://developers.facebook.com/documentation/facebook-login/guides/permissions/request-revoke
2. https://developers.facebook.com/docs/graph-api/reference/user/permissions/
3. https://www.facebook.com/business/help/327596604689624

## Verbindliche Folgerung

Ein lokaler Disconnect allein ist kein sauberer Reconnect. Adbot muss vor dem lokalen Tokenlöschen mit dem noch gültigen Token Metas vollständigen Permissions-Widerruf ausführen. Nur danach darf ein neuer Login-for-Business-Dialog gestartet werden. Der Widerruf muss erfolgreich bestätigt sein; andernfalls darf Adbot den Reconnect nicht als frisch zurückgesetzt ausgeben.

Der Widerruf beseitigt die bestehende Autorisierung. Die nachfolgende Assetmenge muss nach dem neuen Login erneut live geprüft werden; `GET /me/accounts` darf nicht ohne einen nachweislich erfolgreichen frischen Widerruf als aktuelle Auswahl gewertet werden.

## Autoritative System-User-Assetquellen

Die aktuellen offiziellen Meta-v25-Referenzen definieren für einen Business System User drei direkte Assigned-Edges:

- `GET /{system-user-id}/assigned_pages`: ausschließlich diesem Business-System-User zugewiesene Seiten.
- `GET /{system-user-id}/assigned_ad_accounts`: ausschließlich diesem Business-System-User zugewiesene Werbekonten.
- `GET /{system-user-id}/assigned_instagram_accounts`: ausschließlich diesem Business-System-User erlaubte Instagram-Konten.

Diese Edges sind gegenüber `/me/accounts`, `/me/adaccounts` und `page.instagram_business_account` die präzisere Quelle für die vom Business-Login delegierten Assets. Nach einem nachweislich frischen Vollwiderruf muss Adbot deshalb zuerst die drei `assigned_*`-Edges verwenden. Eine Instagram-Seitenverknüpfung darf keine Auswahl mehr erzeugen.

Quellen:

4. https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/system-user/assigned_pages
5. https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/system-user/assigned_ad_accounts
6. https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/system-user/assigned_instagram_accounts

## Production-Beleg vom 5. August 2026, 16:26 MESZ

Der frische, signierte Reconnect erreichte den vorgesehenen System-User-Modus (`tokenType: SYSTEM_USER`, `authorizationReset: true`, alle fünf granularen Ziel-ID-Listen leer). Der Callback scheiterte danach in `asset_discovery` mit Meta Graph Code `100` (`Invalid parameter`).

Die drei oben verlinkten offiziellen Meta-v25-Referenzen beschreiben die System-User-Edges ausdrücklich als **parameterlos**. Der fehlgeschlagene Adbot-Request ergänzte an jede Edge `fields=...` und `limit=25`. Diese Parameter werden entfernt. Die Edges bleiben die alleinige Quelle der gewählten IDs; `/me/accounts`, `/me/adaccounts` und `page.instagram_business_account` dürfen im System-User-Auswahlmodus weiterhin nicht als Auswahlquelle dienen.

## Korrigierter autoritativer Assetvertrag, 5. August 2026

Der Production-Live-Flow liefert weiterhin einen `SYSTEM_USER`-Token mit vorhandenen `granular_scopes`, aber leeren `target_ids`. Meta bestätigt den Dialog trotzdem erfolgreich, weil die Assetauswahl als Business-System-User-Zuweisung erfolgt; `target_ids` sind in diesem Modus nicht die Quelle.

Der früher verwendete Pfad `/{system-user-id}/assigned_instagram_accounts` ist in Graph v25 live **nicht vorhanden** (`OAuthException`, Code 100: `Tried accessing nonexisting field (assigned_instagram_accounts) on node type (SystemUser)`). Metas aktuell generiertes offizielles Python Business SDK bestätigt diesen Live-Befund: `SystemUser` besitzt `assigned_pages` und `assigned_ad_accounts`, aber keine Instagram-Assignment-Methode.

Für die drei ausdrücklich getrennten Dialogauswahlen gilt daher beim Business-System-User-Token:

- Facebook-Seiten: ausschließlich `/{system-user-id}/assigned_pages`.
- Werbekonten: ausschließlich `/{system-user-id}/assigned_ad_accounts`.
- Instagram: Business-Instagram-Assets (`/{client-business-id}/owned_instagram_assets` und gegebenenfalls `client_instagram_assets`) auflisten und je Asset über `/{instagram-asset-id}/assigned_users?business={client-business-id}` ausschließlich diejenigen behalten, deren `AssignedUser.id` dem aktuellen System User entspricht.

Die benötigte Business-ID ist im Login-for-Business-Userobjekt als `client_business_id` verfügbar (`/me?fields=id,client_business_id`); die eigene Git-Historie hatte dieses Feld bereits korrekt gelesen, aber danach mit einem falschen `/instagram_accounts`-Fallback kombiniert.

Im granularen Tokenmodus bleiben die Quellen unverändert strikt getrennt: Seiten ausschließlich aus Page-Scope-`target_ids`, Instagram ausschließlich aus `instagram_basic.target_ids`, Werbekonten ausschließlich aus Ads-Scope-`target_ids`.

Offizielle SDK-Quellen:

1. https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/systemuser.py
2. https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/business.py
3. https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/instagrambusinessasset.py
4. https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/assigneduser.py
