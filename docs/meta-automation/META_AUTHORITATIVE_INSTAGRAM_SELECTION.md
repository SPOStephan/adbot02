# Verbindliche Instagram-Auswahl im Meta-Onboarding

Stand: 5. August 2026

## Meta-Vertrag

Meta dokumentiert für `debug_token`, dass `granular_scopes` granular gewährte Berechtigungen und gegebenenfalls deren Asset-Ziel-IDs enthält. Fehlen Ziel-IDs, bedeutet das nicht automatisch, dass kein Asset delegiert wurde — bei manchen Berechtigungen bedeutet fehlende `target_ids`, dass die Permission „für alle“ gilt.[1]

Bei Business-Integration-System-User-Tokens liefert Meta in der Praxis oft **keine** `instagram_basic`-Ziel-IDs, obwohl Instagram im Login-Dialog gewählt wurde. Seitenverknüpfungen (`page.instagram_business_account`) sind dann trotzdem sichtbar — aber das ist **kein** Auswahlbeleg.

## Verbindlicher Algorithmus

1. Lies `debug_token.granular_scopes` für `instagram_basic`.
2. Sind **Ziel-IDs** vorhanden: nur diese IDs laden und speichern.[4]
3. Fehlen Ziel-IDs: Facebook-Seiten und Werbekonten speichern; Instagram **nicht** automatisch speichern.
4. Dashboard verlangt eine **ausdrückliche Bestätigung** unter den mit dem Token lesbaren, seitenverknüpften Kandidaten. Der Kunde markiert nur die im Meta-Dialog gewählten Konten (z. B. `boncred.official`, nicht `@bonkredit.de`).
5. Erst nach Bestätigung stehen IDs in `instagram_account_ids` / `meta_assets`.
6. Keine automatische Übernahme aus Seitenverknüpfungen und keine fest codierten Kontonamen.

Entfernte Graph-Edges bleiben verboten.[5]

## Quellen

[1]: https://developers.facebook.com/docs/graph-api/reference/debug_token/
[4]: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user
[5]: https://developers.facebook.com/docs/graph-api/changelog/version22.0/
