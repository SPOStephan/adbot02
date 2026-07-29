# Staging Deployment Evidence

Stand: 29. Juli 2026, 13:20 UTC

## Bereitstellungsidentität

| Merkmal | Verifizierter Wert |
|---|---|
| Git-Branch | `feature/meta-oauth-staging` |
| Git-Commit | `e97291cdb82508f79e7e9f2d129af0f5365c6bc0` |
| Vercel-Projekt | `adbot02` (`prj_V4PqhcpIPOqKYshOdA3JoJMl3WgH`) |
| Vercel-Deployment | `dpl_9V4bv95Kz7QqnYTLSFHjptJTj7Gx` |
| Deployment-Typ | Preview (`target = null`), nicht Production |
| Deployment-Status | `READY` |
| Geschützter Branch-Alias | `https://adbot02-git-feature-meta-oauth-staging-fportal.vercel.app` |
| Supabase-Projekt | `Adbot Staging` (`jlxbjnjwqxaajbbtlyhz`) |
| Supabase-Region | `eu-central-1` |

Der Branch-Alias bleibt durch **Vercel Authentication** geschützt. Ein kurzlebiger Prüfzugang wurde nur für die Verifikation verwendet und ist in diesem Dokument bewusst nicht enthalten.

## Datenbankmigrationen

Auf `Adbot Staging` wurden in dieser Reihenfolge ausschließlich die fehlenden vorwärtsgerichteten Migrationen angewendet:

| Remote-Version | Migration |
|---|---|
| `20260729131328` | `meta_write_control_plane` |
| `20260729131342` | `creative_asset_provider` |
| `20260729131355` | `meta_budget_planner` |
| `20260729131415` | `meta_mutation_executor` |
| `20260729131434` | `meta_launch_chain` |
| `20260729131449` | `meta_customer_controls` |

Jeder Apply-Aufruf meldete strukturiert `success: true`; die anschließende Remote-Migrationsauflistung bestätigte alle sechs Versionen in der erwarteten Reihenfolge.

## Sichere Ausgangslage

Eine rein lesende Staging-Abfrage unmittelbar nach der Migration ergab:

| Sicherheitszustand | Wert |
|---|---:|
| Aktive, aktuelle Automation-Policies | 0 |
| Ausführbare Mutation-Pläne | 0 |
| Aktive Mutation-Executions | 0 |
| Konten mit gespeichertem `ads_management` | 0 |

Damit kann der neue Cron-Executor trotz bereitgestellter Route **keinen Remote-Write claimen oder ausführen**. Das Dashboard zeigt entsprechend **Autonomie aus**, den fail-closed Kill-Switch **Writes einfrieren**, keine bestätigte Policy und null Control-Plane-Auditereignisse.

## Staging-Bindung und Laufzeit

Der neue Preview-Health-Endpunkt antwortete erfolgreich mit:

```json
{
  "status": "ok",
  "service": "adpilot-portal",
  "supabaseConfigured": true,
  "configuredConnectors": ["meta"]
}
```

Die Datenbankbindung wurde zusätzlich durch einen unabhängigen Zählwertabgleich bestätigt. Das Preview-Dashboard zeigte 468 Kampagnen, 468 Anzeigengruppen, 464 Anzeigen und 463 Creatives; dieselben vier Werte lieferte eine rein lesende Abfrage direkt gegen `Adbot Staging`.

## Laufzeit- und Privilegiennachweis

Ein direkter Aufruf von `/api/cron/meta-executor` ohne `CRON_SECRET` wurde mit `{"ok":false,"error":"unauthorized"}` abgewiesen. Es wurde dabei keine Execution erzeugt oder geclaimt.

Die installierten Kunden-, Executor- und Launch-RPCs sind `SECURITY DEFINER`, für `service_role` ausführbar und für `authenticated` sowie `anon` nicht ausführbar. Verifiziert wurden insbesondere:

| Funktionsbereich | Browserrollen | Serverrolle |
|---|---|---|
| Policy-Versionierung und Kill-Switch | kein `EXECUTE` | `EXECUTE` |
| Execution- und Step-Claim | kein `EXECUTE` | `EXECUTE` |
| Remote-Dispatch, Completion und Snapshot | kein `EXECUTE` | `EXECUTE` |
| Reconciliation | kein `EXECUTE` | `EXECUTE` |
| Active-Launch-Materializer | kein `EXECUTE` | `EXECUTE` |

## Bewusst nicht ausgeführt

In dieser Bereitstellungsphase wurden **kein Meta-OAuth-Reconnect**, **kein `ads_management`-Grant**, **keine aktive Kunden-Policy**, **kein Kill-Switch `ALLOW`**, **kein Remote-Write**, **keine Testauslieferung** und **keine Production-Bereitstellung** ausgeführt. Diese Schritte bleiben den nachfolgenden kontrollierten Staging- und Production-Gates vorbehalten.
