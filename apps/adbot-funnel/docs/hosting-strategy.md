# Hosting-Strategie und späterer Vercel-Pfad

**Stand:** 8. August 2026 (Manus entfernt)

## Bestätigte Startentscheidung

Für einen schnellen Produktivstart wird die bereits vollständig funktionsfähige Hosting-Umgebung verwendet. Der Funnel bleibt dabei eine eigenständige Website und benötigt keine WordPress-Installation. Die öffentliche Zielseite ist über `/f/karriere` erreichbar; eine WordPress-Einbettung bleibt optional.

| Komponente | Aktueller Eigentümer beziehungsweise Speicherort | Portabilität |
|---|---|---|
| Quellcode und Versionshistorie | Privates GitHub-Repository `SPOStephan/social-recruiting-funnel` | Vollständig portabel |
| Funnel-Konfiguration und Bewerbungen | Eigenes Supabase-Projekt | Vollständig portabel |
| E-Mail-Versand | Eigenes Resend-Konto und verifizierte Domain `boncred.info` | Vollständig portabel |
| Öffentlicher Webserver und Admin-Oberfläche | Aktuelle Hosting-Umgebung | Später migrierbar |
| Admin-Authentifizierung | JWT + Admin-E-Mail/Passwort | Erledigt |
| Lebenslauf-Dateien | Supabase Storage (`application-resumes`) | Erledigt |

Für Kandidaten und Redakteure entsteht durch diese Startentscheidung kein Funktionsverlust. Der konkrete Nachteil ist die verbleibende technische Bindung von **Admin-Login, Lebenslauf-Dateispeicher und Webserverbetrieb**. Die geschäftskritischen strukturierten Daten liegen dagegen bereits in Supabase, der Versand in Resend und der Quellcode in GitHub.

## Warum das Repository nicht unverändert zu Vercel importiert wird

Vercel unterstützt Express-Anwendungen inzwischen direkt und wandelt eine Express-Anwendung in eine skalierende Vercel Function um.[1] Das React-/Express-Framework ist daher nicht der begrenzende Faktor. Ein unveränderter Import wäre trotzdem nicht wirklich unabhängig, weil die aktuellen OAuth- und Storage-Helfer Laufzeitdienste der bestehenden Hosting-Umgebung erwarten.

> Eine technisch erfolgreiche Bereitstellung ist nicht gleichbedeutend mit einer portablen Betriebsarchitektur. Authentifizierung und private Bewerbungsdokumente müssen beim Anbieterwechsel ausdrücklich berücksichtigt werden.

## Empfohlener späterer Vercel-Migrationspfad

| Phase | Änderung | Erfolgskriterium |
|---|---|---|
| 1. Supabase Auth | Eigenen Admin-Login mit Supabase Auth einführen und Serverprozeduren gegen verifizierte Supabase-JWTs schützen | Admin-Zugriff funktioniert ohne bisherige OAuth-Variablen |
| 2. Privater Storage | Bucket `application-resumes` mit MIME-/Größenbegrenzung anlegen und Uploads ausschließlich serverseitig schreiben | Neue Lebensläufe liegen privat in Supabase Storage |
| 3. Sichere Downloads | Kurzlebige, serverseitig erzeugte Signed URLs für berechtigte Admins verwenden | Keine Datei besitzt eine dauerhafte öffentliche URL |
| 4. Bestandsmigration | Vorhandene Lebensläufe übertragen und gespeicherte Objekt-Keys aktualisieren | Jede bestehende Bewerbung behält einen funktionierenden Download |
| 5. Vercel-Laufzeit | Express-App exportierbar machen, statische Vite-Ausgabe anbinden und Variablen in Vercel konfigurieren | Preview- und Produktionsbereitstellung bestehen Smoke-Tests |
| 6. Umschaltung | Eigene Domain nach Paralleltest auf Vercel zeigen lassen | Öffentlicher Funnel, Admin, Upload und E-Mail funktionieren Ende-zu-Ende |

Supabase-Buckets sind standardmäßig privat. Private Dateien können per authentifiziertem Download oder zeitlich begrenzter Signed URL ausgeliefert werden; die Supabase-Dokumentation nennt sensible Nutzerdokumente ausdrücklich als Anwendungsfall.[2]

## Betriebscheck für die schnelle Variante

Vor der Veröffentlichung müssen der öffentliche Funnel, die Admin-Einstellungen, ein gültiger Lebenslauf-Upload und die Zustellung an `job@boncred.info` einmal mit einem ausdrücklich als Test gekennzeichneten Datensatz geprüft werden. Der Datensatz ist anschließend im Admin-Bereich und in Supabase zu löschen, sofern keine Aufbewahrung gewünscht ist.

Die Veröffentlichung selbst erfolgt erst nach einem gespeicherten Projekt-Checkpoint über die **Publish**-Schaltfläche der Management-Oberfläche. Die spätere eigene Domain kann in den Projekteinstellungen gebunden werden.

## References

[1]: https://vercel.com/docs/frameworks/backend/express "Vercel: Express on Vercel"
[2]: https://supabase.com/docs/guides/storage/buckets/fundamentals "Supabase: Storage Buckets – Access Model"
