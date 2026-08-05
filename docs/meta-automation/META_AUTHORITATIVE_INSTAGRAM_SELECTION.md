# Verbindliche Instagram-Auswahl im Meta-Onboarding

Stand: 5. August 2026

## Meta-Vertrag

Meta dokumentiert für `debug_token`, dass `granular_scopes` granular gewährte Berechtigungen und gegebenenfalls deren Asset-Ziel-IDs enthält. Fehlen Ziel-IDs, bedeutet das nicht automatisch, dass kein Asset delegiert wurde — bei manchen Berechtigungen bedeutet fehlende `target_ids`, dass die Permission „für alle“ gilt.[1]

Ein Business-Integration-System-User-Token darf ausschließlich auf die Assets zugreifen, die der Kunde beim Facebook-Login-for-Business-Flow ausdrücklich bezeichnet hat.[2]

## Fehlursache (behoben)

Ein Fallback, der Instagram-Konten aus `page.instagram_business_account` ableitet und per Token-Read „verifiziert“, speichert **nicht ausgewählte** Profile. Beispiel: Zwei Facebook-Seiten werden gewählt, nur ein Instagram-Konto. Beide Seiten können ein verknüpftes IG haben; der Token liest beide — Adbot speicherte fälschlich auch `@bonkredit.de`, obwohl nur `boncred.official` gewählt war.

Seitenverknüpfung ist **keine** Auswahlquelle.

## Verbindlicher Algorithmus

1. Lies `debug_token.granular_scopes` für `instagram_basic`.
2. Sind **Ziel-IDs** vorhanden: nur diese IDs per `GET /<IG_USER_ID>?fields=id,name,username` laden und speichern.[4]
3. Fehlen Ziel-IDs: **kein** Instagram speichern; Callback endet fail-closed mit `no_assets` (Kunde muss im Dialog Instagram ausdrücklich wählen / neu verbinden).
4. `instagram_account_ids` und `meta_assets` enthalten ausschließlich granular bestätigte Profile.
5. Keine Adbot-interne zweite Instagram-Auswahl und keine fest codierten Kontonamen.

Entfernte Graph-Edges (`assigned_instagram_accounts`, Business-`instagram_accounts`, Page-`instagram_accounts`) bleiben verboten.[5]

## Quellen

[1]: https://developers.facebook.com/docs/graph-api/reference/debug_token/
[2]: https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business
[4]: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user
[5]: https://developers.facebook.com/docs/graph-api/changelog/version22.0/
