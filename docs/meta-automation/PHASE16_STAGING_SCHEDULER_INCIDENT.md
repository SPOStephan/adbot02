# Phase 16 — Staging-Scheduler-Incident und Korrektur

**Stand:** 1. August 2026

**Status:** Behoben und im getrennten Staging-Produktionsbetrieb verifiziert.

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

## Staging-Konfigurationsbestand

Das bestehende Vercel-Projekt hält die für `feature/meta-oauth-staging` benötigten Meta-, Supabase- und Cron-Werte als branchgebundene Preview-Variablen. Festgestellt wurden unter anderem `CRON_SECRET`, `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID`, `META_STATE_SECRET`, `META_TOKEN_ENCRYPTION_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` und `NEXT_PUBLIC_SUPABASE_URL`. Die Werte wurden nicht protokolliert oder in dieses Dokument übernommen.

Für das getrennte Projekt müssen diese Werte als Production-Variablen gesetzt werden, weil nur dessen Production-Deployment die Cron Jobs aktiviert. Vercel dokumentiert hierfür den verschlüsselten Projekt-Env-Vertrag sowie den Abruf bestehender Projektvariablen über die autorisierte API beziehungsweise CLI.

5. [Vercel: Create one or more environment variables](https://vercel.com/docs/rest-api/sdk/projects/create-one-or-more-environment-variables)
6. [Vercel: Retrieve project environment variables](https://vercel.com/docs/rest-api/sdk/projects/retrieve-the-environment-variables-of-a-project-by-id-or-name)
7. [Vercel CLI: Environment Variables](https://vercel.com/docs/cli/env)

## Bestätigte Betriebsursache und Reparatur am 1. August 2026

Das getrennte Vercel-Projekt `adbot02-staging` bestand bereits. Es war korrekt mit `SPOStephan/adbot02` verbunden, nutzte `feature/meta-oauth-staging` als Production-Branch und hatte drei aktivierte Production-Crons. In seiner Production-Umgebung fehlte jedoch `CRON_SECRET`. Die Vercel-Runtime-Logs zeigten deshalb wiederholte HTTP-503-Antworten der Cron-Routen, obwohl die Cron-Definitionen selbst aktiv waren.

Für die isolierte Staging-Umgebung wurde ein eigenständiges, kryptografisch zufälliges `CRON_SECRET` als sensitive Production-Variable angelegt. Anschließend wurde Commit `4f4918844666f026c2d7df8d98760da097b297c3` als Production-Deployment `dpl_4ZLH71meXisewvwdnBtoXi7nnsYj` bereitgestellt. Das Deployment erreichte `READY`.

Der offizielle Vercel-Sofortlauf für `/api/cron/meta-sync` wurde am 1. August 2026 um `05:37:13Z` angenommen. Die Runtime-Logs bestätigen für den neuen Deployment-Host HTTP 200. Die vorherigen Hosts zeigen bis zum Secret-Redeploy HTTP 503. Auch der anschließend automatisch laufende `/api/cron/meta-executor` wechselte im neuen Deployment auf HTTP 200.

8. [Vercel CLI: `vercel crons run`](https://vercel.com/docs/cli/crons)
9. [Vercel: Manage Cron Jobs and `CRON_SECRET`](https://vercel.com/docs/cron-jobs/manage-cron-jobs)

## Zusätzlicher Betriebsbefund: Token-Schlüsselstand

Vercels autorisierte Projektansichten zeigen für das getrennte Projekt `adbot02-staging` ein aktives Production-Deployment des Branches `feature/meta-oauth-staging`, drei konfigurierte Production-Crons und seit dem 1. August 2026 ein eigenes `CRON_SECRET`. Der offizielle Sofortlauf von `/api/cron/meta-sync` wurde von Vercel angenommen und der Endpunkt antwortete HTTP 200; die Live-Datenbank verzeichnete für das betroffene Konto anschließend jedoch `last_sync_status = 'error'` und `last_sync_error_code = 'sync_failed'`.

Die Environment-Metadaten grenzen die verbleibende Ursache ein: `META_TOKEN_ENCRYPTION_KEY` im ursprünglichen Projekt wurde am 28. Juli 2026 für Preview/Branch `feature/meta-oauth-staging` angelegt, also im Umfeld des erfolgreichen Meta-Reconnects. Das gleichnamige Production-Secret in `adbot02-staging` stammt dagegen vom 26. Juli 2026. Damit ist der Staging-Cron zwar nun authentifiziert, kann den am 28. Juli mit dem späteren Branch-Schlüssel gespeicherten Meta-Token aber voraussichtlich nicht entschlüsseln. Diese Schlussfolgerung wird erst nach sicherer Schlüsselangleichung und erneutem erfolgreichen Lauf als bestätigt bewertet.

Primärquellen: autorisierte Vercel-Projektseiten `https://vercel.com/fportal/adbot02/settings/environment-variables`, `https://vercel.com/fportal/adbot02-staging/settings/environment-variables` und `https://vercel.com/fportal/adbot02-staging/logs`; Live-Zustand aus dem verbundenen Supabase-Projekt über tenantbegrenzte Diagnoseabfragen.

## Reconnect- und Laufnachweis am 1. August 2026

Der erneute OAuth-Lauf über die kanonische Domain `https://staging.app.adbot.one` wurde in Supabase erfolgreich persistiert. Die aktive Meta-Connectorzeile für das angemeldete Staging-Konto trug `connected_at = 2026-08-01 06:11:31.230408+00`, `revoked_at = null` und die bestätigten Scopes `ads_read`, `ads_management`, `instagram_basic`, `pages_read_engagement` und `pages_show_list`. Der unmittelbar danach aufgenommene Kundenscreenshot zeigte dennoch den Query-Hinweis `meta=connected` zusammen mit „kein aktiver Connector gefunden“; die Datenbank belegte damit einen kurzfristig veralteten Dashboard-Lesezustand und keinen OAuth-Fehlschlag.

Nach dem Reconnect wurde der offizielle Vercel-Sofortlauf für `/api/cron/meta-sync` im Projekt `adbot02-staging` über den autorisierten Vercel-Projektendpunkt ausgelöst. Supabase bestätigte anschließend `sync_status = success`, `sync_error_code = null`, `last_sync_started_at = 2026-08-01 06:15:35.795946+00`, `last_synced_at = 2026-08-01 06:16:28.463+00`, `next_sync_at = 2026-08-01 07:00:00+00`, `last_sync_seen_count = 100` und `last_sync_new_count = 0`. Damit sind Production-Cron, Cron-Authentifizierung, Staging-Verschlüsselungsschlüssel, frisch gespeichertes Meta-Token und Beitragsabruf gemeinsam nachgewiesen.

Quellen: [Vercel-Staging-Projekt](https://vercel.com/fportal/adbot02-staging), [kanonische Staging-Anwendung](https://staging.app.adbot.one), Supabase-Projekt `Adbot Staging` (`jlxbjnjwqxaajbbtlyhz`) und der vom Benutzer am 1. August 2026 bereitgestellte Dashboard-Screenshot.

## Finaler Deploymentnachweis

Commit `82ade3e` (`fix: prevent stale meta callback notice`) wurde am 1. August 2026 ausschließlich auf `feature/meta-oauth-staging` veröffentlicht. Die GitHub-Deploymentchecks `Vercel – adbot02-staging` und `Vercel – adbot02` meldeten beide `success`; im bestehenden Projekt entstand dabei nur das reguläre Preview-Deployment, während `adbot02-staging` das getrennte Production-Deployment erhielt. Die kanonische Domain `https://staging.app.adbot.one` antwortete danach auf `/api/health` mit HTTP 200 und `Cache-Control: no-store`; der unauthentifizierte Dashboardzugriff wurde weiterhin korrekt per HTTP 307 auf `/login?next=%2Fdashboard` umgeleitet.

Der Callback invalidiert nun nach erfolgreichem `replace_meta_connection` explizit den Dashboardpfad. Das Dashboard wird dynamisch ohne Revalidation gerendert und behandelt den nur nach erfolgreicher Persistenz gesetzten Queryzustand `meta=connected` stets als Erfolg. Falls die Accountprojektion im ersten Render noch nicht sichtbar ist, erscheint ausschließlich ein neutraler Aktualisierungshinweis; die falsche rote Meldung „kein aktiver Connector gefunden“ wurde entfernt.
