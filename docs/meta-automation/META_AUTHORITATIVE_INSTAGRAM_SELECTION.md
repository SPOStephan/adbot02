# Verbindliche Instagram-Auswahl im Meta-Onboarding

Stand: 5. August 2026

## Extern verifizierter Vertrag

Meta dokumentiert für `debug_token`, dass `granular_scopes` die granular gewährten Berechtigungen enthält und die zugehörigen Asset-Ziele ausweist; wenn eine Berechtigung für alle Assets gilt, können Ziel-IDs fehlen.

Quelle: https://developers.facebook.com/docs/graph-api/reference/debug_token/

Facebook Login for Business erlaubt der App, Tokentyp, Assets und Berechtigungen in einer Konfiguration festzulegen. Im System-User-Tokenmodell kann die App ausschließlich auf die Business-Assets zugreifen, die der Kunde im Loginflow ausdrücklich delegiert hat.

Quelle: https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business

Ein Instagram Business- oder Creator-Konto kann mit Facebook Login for Business direkt über `GET /<IG_USER_ID>?fields=id,name,username` gelesen werden. Dafür nennt Meta `instagram_basic` und `pages_read_engagement` als relevante Berechtigungen; für Business-Manager-Rollen können zusätzlich `ads_management` beziehungsweise `ads_read` erforderlich sein.

Quelle: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user

Meta stellt außerdem `GET /<BUSINESS_ID>/instagram_accounts` bereit, um Instagram-Konten zu lesen, auf die ein Business Zugriff hat. Die Antwort enthält IGUser-Objekte. Die Business-Manager-Anleitung empfiehlt ausdrücklich Business-Assets statt einer Ableitung über Connection Objects.

Quellen:

- https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/business/instagram_accounts
- https://developers.facebook.com/documentation/ads-commerce/instagram/ads-api/guides/ig-accounts-with-business-manager

Für page-connected Instagram-Konten existiert zusätzlich `/<PAGE_ID>/instagram_accounts`; diese Seitenverknüpfung ist jedoch nur eine mögliche technische Beziehung und darf nicht als Ersatz für die im Login-for-Business-Dialog ausdrücklich gewählte Instagram-Assetmenge verwendet werden.

Quelle: https://developers.facebook.com/documentation/ads-commerce/instagram/ads-api/guides/pages-ig-account

## Aus der Live-Diagnose bestätigte Fehlursache

Der bisherige Callback hat Instagram-Konten ausschließlich über `page.instagram_business_account` aus den ausgewählten Facebook-Seiten abgeleitet. Die granularen `instagram_basic`-Ziel-IDs aus dem Token wurden nicht ausgewertet. Dadurch konnte ein Instagram-Konto gespeichert und angezeigt werden, das an eine ausgewählte Seite gekoppelt, aber im Meta-Dialog bewusst nicht als Instagram-Asset gewählt worden war.

Im Live-Datensatz vom 5. August 2026 war der Connector vollständig berechtigt und der Syncstatus `success`; dennoch enthielt `instagram_account_ids` das an der Facebook-Seite gefundene Konto `bonkredit.de`. Damit war der angezeigte interne Instagram-Onboarding-Schritt kein Scope- oder Reconnectproblem, sondern eine falsche Assetquelle.

## Zielvertrag der Korrektur

1. `instagram_basic`-Ziel-IDs aus `debug_token.granular_scopes` sind die einzige verbindliche Instagram-Auswahl.
2. Nur diese IDs werden direkt über den IGUser-Endpunkt aufgelöst und in `instagram_account_ids` sowie `meta_assets` gespeichert.
3. Eine Seitenverknüpfung darf nur als optionale technische Relation gespeichert werden, niemals als Auswahlquelle.
4. Der nachgelagerte Adbot-eigene Instagram-Auswahlschritt entfällt; er darf Metas Auswahl nicht überschreiben.
5. Instagram-Media wird mit dem Connector-Token für die ausdrücklich ausgewählte IGUser-ID gelesen und nicht davon abhängig gemacht, dass dieses Konto an eine ausgewählte Facebook-Seite gekoppelt ist.
