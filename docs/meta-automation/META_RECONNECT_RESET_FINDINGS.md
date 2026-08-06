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

Meta dokumentiert für Business System User die Edges `assigned_pages`, `assigned_ad_accounts` und `assigned_instagram_accounts`. In Production (5.–6. August 2026) lieferten diese Edges für Login-for-Business-System-User durchgängig Graph Code `100` — zuerst mit `fields`/`limit`, danach mit `appsecret_proof`, danach vollständig parameterlos.

**Live-Vertrag nach diesen Belegen:** Nach nachgewiesenem Vollwiderruf ist das System-User-Token bereits auf die Dialogauswahl begrenzt. Adbot liest deshalb `/me/accounts` und `/me/adaccounts` und übernimmt Instagram über die auf diesen Seiten verknüpften Business-Konten. Ohne Widerrufsnachweis bleibt `/me/*` verboten.

Quellen:

4. https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/system-user/assigned_pages
5. https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/system-user/assigned_ad_accounts
6. https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/system-user/assigned_instagram_accounts

## Production-Beleg vom 5.–6. August 2026

Der frische, signierte Reconnect erreichte den System-User-Modus (`tokenType: SYSTEM_USER`, `authorizationReset: true`, alle granularen Ziel-ID-Listen leer). `assigned_*` scheiterte in `asset_discovery` mit Graph Code `100` trotz Entfernung aller Query-Parameter. Der Connect-Pfad verwendet seither `/me/accounts` + `/me/adaccounts` nur hinter dem Widerrufsnachweis.
