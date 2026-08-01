# Phase 16 — Staging-Scheduler-Incident und Korrektur

**Stand:** 1. August 2026

**Status:** Ursache bestätigt; Korrektur in Umsetzung.

## Beobachtung

Am 1. August 2026 gegen 07:08 Uhr zeigte das Kundendashboard als letzten Beitragsabruf den 29. Juli 2026, 09:40 Uhr, und als nächsten Abruf den 30. Juli 2026, 07:14 Uhr.

Die Live-Datenbankabfrage um 07:14 Uhr Berliner Zeit bestätigte für den aktiven Meta-Connector:

| Feld | Wert |
|---|---|
| `sync_status` | `idle` |
| `sync_error_code` | `null` |
| `last_synced_at` | 29.07.2026, 09:40 Uhr MESZ |
| `next_sync_at` | 30.07.2026, 07:14 Uhr MESZ |
| `sync_lock_until` | `null` |
| `sync_backoff_until` | `null` |
| `sync_consecutive_failures` | `0` |

Damit lag weder ein Meta-Fehler noch ein Lock oder Backoff vor. Der Reconnect am 30. Juli setzte den nächsten Abruf bewusst auf „sofort fällig“; anschließend wurde kein automatischer Lauf ausgeführt.

## Bestätigte Ursache

Die aktuellen Feature-Branch-Builds wurden bei Vercel ausschließlich als Preview-Deployments mit `target: null` bereitgestellt. Das letzte echte Production-Deployment stammt vom `main`-Branch und liegt vor Einführung des Meta-Content-Syncs. Vercel aktiviert Cron Jobs ausschließlich auf Production-Deployments. Preview-Deployments erhalten deshalb keine automatischen Cron-Aufrufe.

> “Cron jobs are only active on production deployments.” — Vercel Cron Jobs Quickstart

Im verfügbaren Runtime-Logfenster existierte entsprechend kein Aufruf von `/api/cron/meta-sync` im Preview-Umfeld.

## Beschlossene Korrektur

Der Feature-Branch erhält einen getrennten Staging-Produktionsbetrieb, damit dessen Cron Jobs aktiv werden, ohne `main` oder bestehende öffentliche Produktionsdomains umzuschalten.

Die Kundenanzeige wird außerdem so normalisiert, dass „Nächster Abruf“ beim Seitenrendern niemals einen fehlenden, ungültigen oder bereits fälligen Datenbankzeitpunkt ausgibt. In diesem Fall wird der nächste reale volle Stundenlauf des konfigurierten Cronplans angezeigt. Interne Überfälligkeit bleibt eine Betriebsdiagnose und wird nicht als Kundenfehler dargestellt.

## Quellen

1. [Vercel: Cron Jobs Quickstart](https://vercel.com/docs/cron-jobs/quickstart)
2. [Vercel: Cron Jobs CLI](https://vercel.com/docs/cli/crons)
3. Live-Deployment-Metadaten des Vercel-Projekts `adbot02`, geprüft am 1. August 2026.
4. Live-Zustand des Supabase-Projekts `Adbot Staging`, Tabelle `public.platform_accounts`, geprüft am 1. August 2026.
