# Verbindliche Instagram-Auswahl im Meta-Onboarding

Stand: 5. August 2026

## Extern verifizierter Vertrag

Meta dokumentiert für `debug_token`, dass `granular_scopes` die granular gewährten Berechtigungen enthält und die zugehörigen Asset-Ziele ausweist; wenn eine Berechtigung für alle Assets gilt, können Ziel-IDs fehlen.

Quelle: https://developers.facebook.com/docs/graph-api/reference/debug_token/

Facebook Login for Business erlaubt der App, Tokentyp, Assets und Berechtigungen in einer Konfiguration festzulegen. Im System-User-Tokenmodell kann die App ausschließlich auf die Business-Assets zugreifen, die der Kunde im Loginflow ausdrücklich delegiert hat.

Quelle: https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business

Ein Instagram Business- oder Creator-Konto kann mit Facebook Login for Business direkt über `GET /<IG_USER_ID>?fields=id,name,username` gelesen werden. Dafür nennt Meta `instagram_basic` und `pages_read_engagement` als relevante Berechtigungen; für Business-Manager-Rollen können zusätzlich `ads_management` beziehungsweise `ads_read` erforderlich sein.

Quelle: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user

Meta stellt für einen System-User den Edge `GET /<SYSTEM_USER_ID>/assigned_instagram_accounts` bereit. Er liefert die diesem System-User erlaubten Instagram-Konten als IGUser-Knoten. Dieser Edge bildet deshalb den autoritativen Fallback, wenn `debug_token.granular_scopes[].target_ids` für `instagram_basic` fehlt.

Quellen:

- https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/system-user/assigned_instagram_accounts
- https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/system-user

Für page-connected Instagram-Konten existiert zusätzlich `/<PAGE_ID>/instagram_accounts`; diese Seitenverknüpfung ist jedoch nur eine mögliche technische Beziehung und darf nicht als Ersatz für die im Login-for-Business-Dialog ausdrücklich gewählte Instagram-Assetmenge verwendet werden.

Quelle: https://developers.facebook.com/documentation/ads-commerce/instagram/ads-api/guides/pages-ig-account

## Aus der Live-Diagnose bestätigte Fehlursache

Der bisherige Callback hat Instagram-Konten ausschließlich über `page.instagram_business_account` aus den ausgewählten Facebook-Seiten abgeleitet. Die granularen `instagram_basic`-Ziel-IDs aus dem Token wurden nicht ausgewertet. Dadurch konnte ein Instagram-Konto gespeichert und angezeigt werden, das an eine ausgewählte Seite gekoppelt, aber im Meta-Dialog bewusst nicht als Instagram-Asset gewählt worden war.

Im Live-Datensatz vom 5. August 2026 war der Connector vollständig berechtigt und der Syncstatus `success`; dennoch enthielt `instagram_account_ids` das an der Facebook-Seite gefundene Konto `bonkredit.de`. Damit war der angezeigte interne Instagram-Onboarding-Schritt kein Scope- oder Reconnectproblem, sondern eine falsche Assetquelle.

## Zielvertrag der Korrektur

1. Vorhandene `instagram_basic`-Ziel-IDs aus `debug_token.granular_scopes` sind der strengste verbindliche Instagram-Filter.
2. Fehlen diese Ziel-IDs beim Business-Integration-System-User, wird ausschließlich `GET /<SYSTEM_USER_ID>/assigned_instagram_accounts` mit demselben eingeschränkten Connector-Token verwendet.
3. Nur die über einen dieser beiden Meta-autoritativen Pfade gelesenen IDs werden in `instagram_account_ids` und `meta_assets` gespeichert.
4. Eine Seitenverknüpfung darf nur als optionale technische Relation gespeichert werden, niemals als Auswahlquelle.
5. Der nachgelagerte Adbot-eigene Instagram-Auswahlschritt entfällt; er darf Metas Auswahl nicht überschreiben.
6. Instagram-Media wird mit dem Connector-Token für die ausdrücklich ausgewählte IGUser-ID gelesen und nicht davon abhängig gemacht, dass dieses Konto an eine ausgewählte Facebook-Seite gekoppelt ist.

## Ergänzung nach den Production-Fehlern vom 5. August 2026

Der erfolgreiche Meta-Dialog kann bei einem Business-Integration-System-User alle gewählten Assets anzeigen, obwohl `debug_token.granular_scopes[].target_ids` für `instagram_basic` leer ist. Der erste Fallbackversuch über `GET /<CLIENT_BUSINESS_ID>/instagram_accounts` schlug im instrumentierten Production-Callback während `asset_discovery` mit Meta-Graph-Code `200` fehl; dieser Business-Edge setzt damit einen breiteren Berechtigungsvertrag voraus und ist für das bestehende Onboarding ungeeignet.

Meta dokumentiert für genau diesen Fall `GET /<SYSTEM_USER_ID>/assigned_instagram_accounts` als lesbaren Edge für die dem System-User erlaubten Instagram-Konten. Die System-User-ID ist bereits die validierte Identität aus `GET /me?fields=id` und stimmt mit `debug_token.user_id` überein.

Quellen:

- https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/system-user/assigned_instagram_accounts
- https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/system-user

Der finale Hotfix verwendet daher vorhandene granulare Ziel-IDs als primären Pfad und bei deren Fehlen ausschließlich die dem validierten System-User zugewiesenen Instagram-Konten. `client_business_id`, `business_management`, `/<BUSINESS_ID>/instagram_accounts` und `page.instagram_business_account` sind keine Auswahlquellen.
