# Supabase-Migrationsstatus

Stand: 27. Juli 2026

Die vorbereitete Migration `supabase/migrations/202607270001_initial_recruiting_schema.sql` wurde über drei Wege geprüft.

Der Supabase-Verwaltungskanal verweigert sowohl `apply_migration` als auch `execute_sql` für das Projekt `vmrsuyyylybucuomiqpd` mit `You do not have permission to perform this action`.

Im angemeldeten Supabase-Dashboard lässt sich der SQL-Editor öffnen. Am 27. Juli 2026 wurde die vollständige Migration nach ausdrücklicher Bestätigung erneut in das erkannte Editor-Element eingesetzt. Der SQL-Text war visuell vollständig vorhanden. Beim Klick auf **Run** meldete die Oberfläche jedoch erneut `Error: query: Too small: expected string to have >=1 characters`. Dies bestätigt, dass der direkte DOM-Eingabeweg sichtbaren Text setzt, das interne Monaco-Modell aber nicht aktualisiert.

Die Migration wurde anschließend durch den angemeldeten Nutzer direkt im SQL-Editor erfolgreich ausgeführt. Dabei wurden die Tabellen `public.funnels` und `public.applications`, beide Indizes, der `updated_at`-Trigger sowie die RLS-Aktivierung angelegt.

Für diesen nativen Versuch wurde der geprüfte SQL-Inhalt in das reguläre Such-Eingabefeld des SQL-Editors geschrieben. Dadurch kann er per `Control+A`, `Control+C` und anschließendem `Control+V` über echte Tastaturereignisse in Monaco übertragen werden, statt dessen sichtbares DOM direkt zu verändern.

Die Auswahl und der native Kopiervorgang im regulären Eingabefeld wurden erfolgreich ausgelöst. Der nächste Schritt ist das Fokussieren des Monaco-Editors und das native Einfügen der Browser-Zwischenablage.

Der Monaco-Editor wurde anschließend fokussiert und `Control+V` als natives Browserereignis ausgelöst. Da der bereits sichtbare DOM-Text identisch ist, lässt sich die interne Modellübernahme erst durch einen erneuten Lauf oder eine anschließende Tabellenabfrage bestätigen.

Ein erster Produktionstest bestätigte die Existenz beider Tabellen, zeigte jedoch fehlende explizite Rechte für `service_role`. Daraufhin wurde ein idempotenter Berechtigungsnachtrag ausgeführt: `anon` und `authenticated` bleiben ohne Tabellenzugriff, während ausschließlich `service_role` Lese- und Schreibrechte besitzt. Die Migrationsquelldatei enthält diesen Nachtrag dauerhaft.

Der abschließende nicht-destruktive Vitest-Lauf bestätigte am 27. Juli 2026 alle vier Produktionsprüfungen: Supabase-Service-Authentifizierung, lesbarer Zugriff auf `funnels`, lesbarer Zugriff auf `applications` und gültiger Resend-API-Zugang mit bestätigtem Absender unter `boncred.info`. Es wurden keine Testdatensätze in die Produktion geschrieben.

| Produktionskomponente | Status |
|---|---|
| Supabase-Projekt | `social-recruiting-funnel` (`vmrsuyyylybucuomiqpd`) |
| Tabellen | `public.funnels`, `public.applications` erreichbar |
| RLS | Für beide Tabellen aktiviert |
| Browserrollen | `anon` und `authenticated` ohne Tabellenrechte |
| Serverrolle | `service_role` mit expliziten Lese-/Schreibrechten |
| Resend | API-Zugang und Absenderdomain `boncred.info` validiert |
