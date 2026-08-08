# Infrastruktur

## Supabase

Das eigenständige Produktionsprojekt wurde in der Supabase-Pro-Organisation **Meer Erfolg GmbH** angelegt.

| Eigenschaft | Wert |
|---|---|
| Projektname | `social-recruiting-funnel` |
| Projekt-ID | `vmrsuyyylybucuomiqpd` |
| Projekt-URL | `https://vmrsuyyylybucuomiqpd.supabase.co` |
| Region | Central EU (Frankfurt), `eu-central-1` |
| Compute | Micro, 1 GB RAM / 2 CPU-Kerne |
| Zusätzliche Kosten | 10 USD pro Monat, vom Auftraggeber bestätigt |
| Data API | aktiviert |
| Neue Tabellen automatisch exponieren | deaktiviert |
| Automatische Row-Level Security | aktiviert |

Das generierte Datenbankpasswort und weitere geheime Schlüssel werden nicht im Repository gespeichert. Sie sind ausschließlich über sichere Umgebungsvariablen beziehungsweise die jeweilige Secret-Verwaltung zu hinterlegen.

### Zugriffskonzept und verifizierter Status

Die Anwendung greift **ausschließlich serverseitig** mit `SUPABASE_SERVICE_ROLE_KEY` auf Supabase zu. Der Browser verwendet weder Supabase-Schlüssel noch die Data API direkt. Deshalb existieren bewusst **keine freigebenden RLS-Policies** für `anon` oder `authenticated`: Beide Rollen besitzen keine Tabellenrechte, und die aktivierte RLS sperrt zusätzlich jeden nicht privilegierten Zeilenzugriff. Nur `service_role` besitzt explizite Rechte zum Lesen, Anlegen, Ändern und Löschen der beiden Anwendungstabellen.

| Kontrolle | Verifizierter Zustand am 27. Juli 2026 |
|---|---|
| Migration | Erfolgreich im SQL-Editor ausgeführt |
| `public.funnels` | Über `service_role` erreichbar |
| `public.applications` | Über `service_role` erreichbar |
| RLS | Auf beiden Tabellen aktiviert |
| Freigebende RLS-Policies | Bewusst keine; kein direkter Browserzugriff vorgesehen |
| `anon` / `authenticated` | Tabellenrechte explizit entzogen |
| `service_role` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` explizit erteilt |
| Verifikation | Vier nicht-destruktive Produktionstests erfolgreich; keine Testdaten geschrieben |

Diese Konfiguration hält personenbezogene Bewerbungsdaten hinter dem geschützten Anwendungsserver. Sollte später ein direkter Supabase-Zugriff aus dem Browser eingeführt werden, müssen zuvor eng begrenzte RLS-Policies mit Eigentums- und Mandantenprüfung entworfen werden; die aktuelle Konfiguration darf dafür nicht pauschal geöffnet werden.

## Resend

Der Resend-API-Zugang und ein Absender unter der verifizierten Domain `boncred.info` wurden mit einem nicht-destruktiven API-Test bestätigt. `RESEND_API_KEY` und `MAIL_FROM` werden ausschließlich als serverseitige Secrets hinterlegt. Die Empfängeradresse bleibt pro Funnel im geschützten Admin-Bereich konfigurierbar.
