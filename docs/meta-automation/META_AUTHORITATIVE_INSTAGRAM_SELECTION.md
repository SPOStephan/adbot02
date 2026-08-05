# Verbindliche Instagram-Auswahl im Meta-Onboarding

Stand: 5. August 2026

## Meta-Vertrag

Meta dokumentiert für `debug_token`, dass `granular_scopes` granular gewährte Berechtigungen und gegebenenfalls deren Asset-Ziel-IDs enthält. Fehlen Ziel-IDs, bedeutet das nicht automatisch, dass kein Asset delegiert wurde — bei manchen Berechtigungen bedeutet fehlende `target_ids`, dass die Permission „für alle“ gilt.[1]

`target_ids` sind laut Meta-Referenz Integer-Arrays. Instagram- und Seiten-IDs sind oft größer als `Number.MAX_SAFE_INTEGER`. Adbot schützt deshalb **unquotierte** lange Ziffernfolgen in `target_ids` vor `JSON.parse` und akzeptiert String- sowie sichere Zahlwerte.[1]

Ein Business-Integration-System-User-Token darf ausschließlich auf die Assets zugreifen, die der Kunde beim Facebook-Login-for-Business-Flow ausdrücklich bezeichnet hat.[2]

## Fehlursachen (behoben)

1. **Typverlust:** Numerische `target_ids` wurden verworfen → Instagram wirkte leer.
2. **Seiten-Fallback:** Profile aus `page.instagram_business_account` zu speichern ist **kein** Auswahlbeleg. So erschien `@bonkredit.de`, obwohl im Dialog nur `boncred.official` gewählt war. Auch ein „eindeutiger“ Einzel-Kandidat ist ein Fantasiewert.

Seitenverknüpfung ist **niemals** eine Instagram-Auswahlquelle.

## Verbindlicher Algorithmus

1. Lies `debug_token.granular_scopes` für `instagram_basic`.
2. Sind **Ziel-IDs** vorhanden: nur diese IDs per `GET /<IG_USER_ID>?fields=id,name,username` laden und speichern.[4]
3. Fehlen Ziel-IDs: Callback endet mit `missing_instagram_targets` — **kein** Instagram speichern, kein Seiten-Fallback.
4. `instagram_account_ids` und `meta_assets` (Typ `instagram_account`) enthalten ausschließlich granular bestätigte Profile.
5. Dashboard zeigt Instagram nur, wenn die Asset-ID in `instagram_account_ids` steht.
6. Keine Adbot-interne Instagram-Auswahl und keine fest codierten Kontonamen.

Entfernte Graph-Edges (`assigned_instagram_accounts`, Business-`instagram_accounts`, Page-`instagram_accounts`) bleiben verboten.[5]

## Quellen

[1]: https://developers.facebook.com/docs/graph-api/reference/debug_token/
[2]: https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business
[4]: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user
[5]: https://developers.facebook.com/docs/graph-api/changelog/version22.0/
