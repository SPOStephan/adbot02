# Verbindliche Instagram-Auswahl im Meta-Onboarding

Stand: 5. August 2026

## Meta-Vertrag

Meta dokumentiert für `debug_token`, dass `granular_scopes` granular gewährte Berechtigungen und gegebenenfalls deren Asset-Ziel-IDs enthält. Fehlen Ziel-IDs, bedeutet das nicht automatisch, dass kein Asset delegiert wurde — bei manchen Berechtigungen bedeutet fehlende `target_ids`, dass die Permission „für alle“ gilt.[1]

`target_ids` sind laut Meta-Referenz Integer-Arrays. Instagram- und Seiten-IDs sind oft größer als `Number.MAX_SAFE_INTEGER`. Adbot schützt deshalb lange Ziffernfolgen in `target_ids` vor `JSON.parse` und akzeptiert sowohl String- als auch Zahlwerte.[1]

Ein Business-Integration-System-User-Token darf ausschließlich auf die Assets zugreifen, die der Kunde beim Facebook-Login-for-Business-Flow ausdrücklich bezeichnet hat.[2]

## Fehlursachen

1. **Typverlust:** Wurden `target_ids` nur als Strings akzeptiert, gingen numerische Meta-IDs verloren. Seiten/Werbekonten liefen trotzdem (leerer Filter = `/me/...`-Ergebnis). Instagram ohne IDs schlug fehl oder fiel auf Seitenverknüpfungen zurück.
2. **Seiten-Fallback ohne Eindeutigkeit:** Alle lesbaren `page.instagram_business_account`-Profile zu speichern, legt nicht ausgewählte Konten an (Beispiel: `@bonkredit.de` trotz Auswahl nur `boncred.official`).

Seitenverknüpfung ist **keine** Mehrfach-Auswahlquelle.

## Verbindlicher Algorithmus

1. Lies `debug_token.granular_scopes` für `instagram_basic` (IDs als String, inkl. Schutz großer Integers).
2. Sind **Ziel-IDs** vorhanden: nur diese IDs per `GET /<IG_USER_ID>?fields=id,name,username` laden und speichern.[4]
3. Fehlen Ziel-IDs: prüfe Seiten-verknüpfte Kandidaten mit demselben Connector-Token.
   - **Genau ein** lesbares Profil → speichern (`unique_page_candidate`).
   - **Mehrere** lesbare Profile → fail-closed mit `ambiguous_instagram` (nichts speichern).
   - **Keines** → `no_assets`.
4. `instagram_account_ids` und `meta_assets` enthalten ausschließlich so bestätigte Profile.
5. Keine Adbot-interne freie Instagram-Auswahl und keine fest codierten Kontonamen.

Entfernte Graph-Edges (`assigned_instagram_accounts`, Business-`instagram_accounts`, Page-`instagram_accounts`) bleiben verboten.[5]

## Quellen

[1]: https://developers.facebook.com/docs/graph-api/reference/debug_token/
[2]: https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business
[4]: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user
[5]: https://developers.facebook.com/docs/graph-api/changelog/version22.0/
