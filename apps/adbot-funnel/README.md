# Social Recruiting Funnel

Der **Adbot Funnel** ist eine eigenständige, mobile Bewerbungs-/Lead-Anwendung mit öffentlichem Kandidaten-Funnel, geschütztem Admin-Bereich, visuellem Seiteneditor, Bewerbungsverwaltung sowie CSV- und PDF-Export. Die produktive Konfiguration und alle Bewerbungsdaten liegen in Supabase; Benachrichtigungen werden über Resend versendet.

## Funktionsumfang

| Bereich | Umsetzung |
|---|---|
| Öffentlicher Funnel | Eigenständige Route `/f/:slug`, mobile-first, Fortschrittsanzeige und Validierung |
| Seitentypen | Startseite, 2×2-Symbolauswahl, kompakte Listenwahl und Kontaktabschluss |
| Bewerbung | Konfigurierbare Kontaktfelder, Einwilligung und optionaler PDF/DOC/DOCX-Upload |
| Funnel-Bibliothek | Beliebig viele Funnel mit Suche, Statusfilter, Kennzahlen, neuer Vorlage und Kopierfunktion |
| Lebenszyklus | Entwurf, veröffentlicht, pausiert und archiviert; Archivierung ist reversibel |
| Admin | Globale oder funnelbezogene Bewerbungsübersicht, Suche, Statusfilter, Detailansicht und Exporte |
| Editor | ID-gebundene Bearbeitung von Inhalten, Optionen, Seitenreihenfolge, Branding und globalen Texten mit Live-Vorschau |
| Persistenz | Supabase-Tabellen `funnels` und `applications` |
| E-Mail | Eine gebündelte Resend-Benachrichtigung je erfolgreich gespeicherter Bewerbung; Antworten tragen die internen Seitennamen statt technischer Question-IDs |
| Einbettung | Optionales responsives WordPress-`iframe`; der Direktlink funktioniert unabhängig davon |
| Rechtliches | Eigenes Pflicht-Impressum je Funnel; der Link steht auf jedem öffentlichen Funnel-Schritt neben dem Datenschutzlink |
| Nach dem Absenden | Wahlweise bestehende Erfolgsnachricht oder Weiterleitung auf eine validierte absolute HTTPS-URL |
| Meta Conversion | Bei aktiviertem Funnel automatischer Browser-Pixel und optionale serverseitige Conversions API mit gemeinsamer Event-ID zur Deduplizierung |

## Architektur

```text
Browser
  ├─ Öffentlicher Funnel
  └─ Geschützter Admin-Bereich
          │
          ▼
React 19 + tRPC + Express
  ├─ Supabase PostgreSQL: Konfiguration und Bewerbungen
  ├─ Resend: Bewerbungsbenachrichtigungen
  ├─ Meta Pixel / Conversions API: pro Funnel aktivierbare automatische Conversion-Messung
  └─ Supabase Storage: Lebensläufe und Branding-Dateien
```

Der Browser besitzt keinen Supabase-Service-Schlüssel und greift nicht direkt auf die Bewerbungstabellen zu. Beide Tabellen haben aktivierte Row-Level Security; `anon` und `authenticated` besitzen keine Tabellenrechte. Ausschließlich der Server verwendet `service_role`. Weitere Details stehen in [`docs/infrastructure.md`](docs/infrastructure.md).

## Routen

| Route | Zweck |
|---|---|
| `/f/:slug` | Eigenständiger öffentlicher Funnel; nur veröffentlichte Funnel sind erreichbar |
| `/f/:slug/impressum` | Funnelbezogene Impressumsansicht mit Rückweg zur Bewerbung |
| `/admin` | Funnel-Bibliothek mit Suche, Status, Kennzahlen und Verwaltungsaktionen |
| `/admin/funnels/:id/editor` | Visueller Editor des per UUID gewählten Funnels |
| `/admin/funnels/:id/settings` | Veröffentlichung, Empfänger, Datenschutz, Impressum, Absendeverhalten, Meta-Tracking und Einbettung je Funnel |
| `/admin/funnels/:id/applications` | Bewerbungen und Exporte des gewählten Funnels |
| `/admin/funnels/:id/applications/:applicationId` | Bewerbungsdetail mit funnelbezogenem Rückweg |
| `/admin/applications` | Funnelübergreifende Bewerbungen mit Funnel- und Statusfilter |
| `/admin/applications/:id` | Globale Bewerbungsdetailansicht |

## Lokale Entwicklung

Installieren Sie Node.js und `pnpm`, klonen Sie das private Repository und starten Sie anschließend die Entwicklungsumgebung:

```bash
pnpm install
pnpm dev
```

Die Anwendung benötigt folgende serverseitige Konfigurationsgruppen. Geheimwerte dürfen niemals in das Repository oder in Variablen mit öffentlich gebündeltem `VITE_`-Präfix eingetragen werden.

| Gruppe | Variablen | Zweck |
|---|---|---|
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Funnel- und Bewerbungsdaten |
| Storage | `STORAGE_BUCKET` (Default `application-resumes`) | Private Lebensläufe/Favicons in Supabase Storage |
| Resend | `RESEND_API_KEY`, `MAIL_FROM` | Gebündelte Benachrichtigung |
| Admin-Authentifizierung | `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Geschützte Admin-Sitzung ohne Manus |

Die produktive SQL-Migration liegt unter [`supabase/migrations/202607270001_initial_recruiting_schema.sql`](supabase/migrations/202607270001_initial_recruiting_schema.sql). Sie ist idempotent und enthält Tabellen, Indizes, Trigger, RLS-Aktivierung sowie explizite Rollenrechte.

## Qualitätssicherung

```bash
pnpm check
pnpm test
pnpm build
```

Die Vitest-Suite umfasst **58 Tests in 20 Dateien**. Sie deckt unter anderem Schemas, kollisionsfreie Slugs, neue Vorlagen, tiefe Funnel-Kopien mit neuen technischen IDs, Status- und Berechtigungsgrenzen, verlustfreie Bestandsnormalisierung, den kombinierten Bewerbungsfilter, den öffentlichen tRPC-Submit-Ablauf, lesbare interne Seitennamen in Bewerbungsdetail und E-Mail, rückwärtskompatible Antwort-Fallbacks, CSV-/PDF-Exporte, Sicherheitsheader, Pflicht-Impressum, sichere HTTPS-Weiterleitung, automatisches Pixel-/CAPI-Tracking bei aktiviertem Funnel, Pixel-Deduplizierung, verschlüsselte Meta-Zugangsdaten und nicht-blockierende Conversions-API-Fehler ab. Produktionszugangstests sind bewusst opt-in und führen keine schreibenden Operationen aus.

Ein zusätzlicher Headless-Chromium-Smoke-Test bedient die reale React-Oberfläche für Neuerstellung, Editor-Speichern, Einstellungen-Speichern, Kopieren und Archivieren. Er darf nur gegen eine ausdrücklich gewählte Vorschau-URL ausgeführt werden, weil er kurzzeitig streng markierte E2E-Funnel anlegt. Vor der Bereinigung prüft er, dass diese keine Bewerbungen besitzen, und entfernt ausschließlich Slugs im Format `e2e-mehr-funnel-<acht Ziffern>` beziehungsweise `-kopie`:

```bash
node scripts/multifunnel-browser-smoke.mjs https://ihre-vorschau.example
```

## Veröffentlichung und Portabilität

Für den schnellen Start wird die bereits eingerichtete Hosting-Umgebung verwendet. Supabase, Resend und GitHub sind davon unabhängig; Admin-Login läuft über E-Mail/Passwort (JWT); Dateien liegen in Supabase Storage. Die genaue Abgrenzung und der spätere Vercel-Pfad stehen in [`docs/hosting-strategy.md`](docs/hosting-strategy.md).

Der Admin-Bereich verwaltet nun mehrere Funnel über stabile UUIDs. Öffentliche URLs bleiben slug-basiert; der bestehende Produktionsfunnel behält deshalb unverändert `/f/karriere`. Neue Funnel beginnen als Entwurf, Kopien übernehmen Konfiguration und Branding, jedoch niemals Bewerbungen oder Lebenslaufdateien. Das verbindliche Modell steht in [`docs/multi-funnel-architecture.md`](docs/multi-funnel-architecture.md); der geprüfte Ausbau ist in [`docs/multi-funnel-smoke-test.md`](docs/multi-funnel-smoke-test.md) dokumentiert.

## Weitere Dokumentation

| Dokument | Inhalt |
|---|---|
| [`docs/infrastructure.md`](docs/infrastructure.md) | Supabase-, Resend- und Sicherheitsarchitektur |
| [`docs/wordpress-embedding.md`](docs/wordpress-embedding.md) | Optionale WordPress-Einbettung |
| [`docs/meta-conversions-setup.md`](docs/meta-conversions-setup.md) | Einrichtung, Test und Datenschutzgrenzen für Meta Pixel und Conversions API |
| [`docs/visual-qa-impressum-meta.md`](docs/visual-qa-impressum-meta.md) | Desktop-, Mobil- und Interaktionsprüfung der neuen Funktionen |
| [`docs/visual-qa-meta-auto.md`](docs/visual-qa-meta-auto.md) | Desktop-, Mobil- und Formularprüfung des automatischen Meta-Flows ohne separate Checkbox |
| [`docs/visual-qa-answer-labels.md`](docs/visual-qa-answer-labels.md) | Reale Desktop-/Mobilprüfung interner Seitennamen in Bewerbungen |
| [`docs/resend-all-inkl-dns.md`](docs/resend-all-inkl-dns.md) | Resend-DNS bei ALL-INKL |
| [`docs/visual-review.md`](docs/visual-review.md) | Desktop- und Mobilprüfung |
| [`docs/multi-funnel-architecture.md`](docs/multi-funnel-architecture.md) | Verbindliches Mehr-Funnel-Domänen-, Status- und Routingmodell |
| [`docs/multi-funnel-smoke-test.md`](docs/multi-funnel-smoke-test.md) | Produktionsnahe Bestands-, Browser- und Regressionstests |
| [`docs/multi-funnel-roadmap.md`](docs/multi-funnel-roadmap.md) | Historische Ausbauplanung und spätere Erweiterungsmöglichkeiten |
| [`todo.md`](todo.md) | Vollständige, nicht gelöschte Umsetzungshistorie |

## Lizenz

MIT
