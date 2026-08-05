# Verbindliche Instagram-Auswahl im Meta-Onboarding

Stand: 5. August 2026

## Meta-Vertrag

Meta dokumentiert für `debug_token`, dass `granular_scopes` granular gewährte Berechtigungen und gegebenenfalls deren Asset-Ziel-IDs enthält. Fehlen Ziel-IDs, bedeutet das nicht automatisch, dass kein Asset delegiert wurde.[1]

Ein Business-Integration-System-User-Token darf ausschließlich auf die Assets zugreifen, die der Kunde beim Facebook-Login-for-Business-Flow ausdrücklich bezeichnet hat.[2] Für Instagram API with Facebook Login ist in Graph API v25 der unterstützte Discovery-Pfad `GET /me/accounts?fields=id,name,access_token,instagram_business_account`. Die Antwort liefert die Instagram-Professional-Account-IDs der zugänglichen Facebook-Seiten.[3]

Ein Instagram Business- oder Creator-Profil wird anschließend direkt über `GET /<IG_USER_ID>?fields=id,name,username` gelesen.[4] Weil der Connector-Token ausschließlich die im Loginflow delegierten Assets erreichen darf, ist ein erfolgreicher direkter Profilabruf der verbindliche Filter für Seitenkandidaten, wenn `debug_token` keine `instagram_basic`-Ziel-IDs liefert.[2]

Meta hat ab Graph API v22 mehrere ältere Instagram-Asset-Edges entfernt. Dazu gehören unter anderem `/<SYSTEM_USER_ID>/assigned_instagram_accounts`, `/<BUSINESS_ID>/instagram_accounts` und `/<PAGE_ID>/instagram_accounts`; Adbot verwendet Graph API v25 und darf diese Pfade deshalb nicht verwenden.[5]

## Durch Production-Logs belegte Fehlursachen

Der ursprüngliche Callback leitete Instagram-Konten ausschließlich aus `page.instagram_business_account` ab. Dadurch konnte ein mit einer ausgewählten Facebook-Seite verbundenes, im Meta-Dialog aber bewusst nicht gewähltes Instagram-Konto gespeichert werden.

Der erste Korrekturversuch über `/<CLIENT_BUSINESS_ID>/instagram_accounts` scheiterte im Production-Callback während `asset_discovery` mit Meta-Code `200`. Der zweite Versuch über `/<SYSTEM_USER_ID>/assigned_instagram_accounts` scheiterte in Graph API v25 mit Meta-Code `100`, weil dieser Edge nicht mehr unterstützt wird.

## Finaler Graph-v25-Algorithmus

1. Sind in `debug_token.granular_scopes` Ziel-IDs für `instagram_basic` vorhanden, werden ausschließlich diese IDs direkt gelesen.
2. Fehlen diese Ziel-IDs, werden Instagram-IDs aus den bereits durch Metas Seiten-Edge gefilterten Facebook-Seiten nur als **Kandidaten** gesammelt.
3. Jeder Kandidat wird direkt mit demselben Business-Integration-System-User-Token über `/<IG_USER_ID>?fields=id,name,username` gelesen.
4. Nur erfolgreich gelesene Profile werden gespeichert. Meta-Fehler `10`, `100` oder `200` für einen einzelnen Kandidaten bedeuten, dass dieses Profil nicht durch den Token freigegeben ist; der Kandidat wird verworfen, ohne den gesamten Callback abzubrechen.
5. `instagram_account_ids` und `meta_assets` enthalten ausschließlich die so von Meta bestätigten Profile. Eine Seitenverknüpfung allein ist niemals eine Auswahlquelle.
6. Es gibt keine Adbot-interne zweite Instagram-Auswahl und keine kundenspezifischen IDs oder Kontonamen im Laufzeitcode.

## Quellen

[1]: https://developers.facebook.com/docs/graph-api/reference/debug_token/
[2]: https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business
[3]: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/business-login-for-instagram
[4]: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user
[5]: https://developers.facebook.com/docs/graph-api/changelog/version22.0/
