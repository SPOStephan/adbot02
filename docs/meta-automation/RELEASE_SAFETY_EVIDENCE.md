# Meta Automation Release Safety Evidence

**Stand:** 29. Juli 2026  
**Geltungsbereich:** Adbot Meta Control Plane auf Vercel, Supabase und Meta Marketing API v25.0  
**Repository-Status:** Code- und Datenbankvertrag als Release Candidate bestanden  
**Externer Status:** Noch kein echter Meta-Staging-Write ausgeführt

## 1. Zweck und Prüfmethode

Dieser Nachweis verbindet jede sicherheitsrelevante Produktgrenze mit ihrem **autoritativen Durchsetzungsort** und einer **ausführbaren Regression**. Eine UI-Anzeige gilt dabei nicht als Sicherheitsgrenze. Kundencaps, Autonomiefreigaben, OAuth-Scope, Kill-Switch, rollierende Budgetbewegung, Cooldown, Exposure, Idempotenz und Reconciliation werden erneut im serverseitigen Service, in PostgreSQL und unmittelbar vor einem Remote-Dispatch geprüft.

Der kanonische Release-Test ist:

```bash
npm run test:meta-all
```

Der Befehl führt Security-, OAuth-, Dashboard-, Content-/Marketing-Sync-, Write-Client-, Kunden-Control-, Runtime-Executor- und Fresh-Cluster-SQL-Regressionen in fester Reihenfolge aus. Der letzte vollständige Lauf am 29. Juli 2026 war erfolgreich.

## 2. Sicherheitsinvarianten und ausführbare Evidenz

| Invariante | Autoritative Durchsetzung | Ausführbare Evidenz | Ergebnis |
|---|---|---|---|
| Autonomie ohne Kundenlimits ist unmöglich | `automation_policies`, `put_meta_customer_policy_version` | `scripts/test-meta-write-control-plane.sql`: aktive Policy ohne Caps wird abgewiesen | Bestanden |
| Geldwerte bleiben exakte EUR-Minor-Units | Kunden-Input-Validator, Policy-RPC, EUR-Kontowährungsgate | `scripts/test-meta-customer-controls.mjs`; Fresh-Cluster-Policytest | Bestanden |
| Kampagnen-Hard-Cap darf nie überschritten werden | `reserve_meta_daily_budget_exposure` unter Account-/Policy-/Snapshot-Sperre | Exakt `6.000` Minor Units akzeptiert; `6.001` atomar abgewiesen | Bestanden |
| Account-Hard-Cap darf nie überschritten werden | monotone Exposure-Reservierung und Account-Lock | Exakt `10.000` Minor Units akzeptiert; `10.001` atomar abgewiesen; keine Restreservierung | Bestanden |
| Standard-Flexspend wird konservativ mit mindestens 1,75 reserviert | Exposure-Funktion und Policy-Constraint | Standardbudget `2.000` reserviert `3.500` Minor Units | Bestanden |
| Shared-/unbekannte Budgetteilung nutzt mindestens 2,10 | Sharing-Snapshot, Planner, Exposure-Funktion | `2.000` reserviert `4.200`; kleinerer Multiplikator wird abgewiesen | Bestanden |
| Exposure kann innerhalb eines Tages nicht durch Budgetsenkung reduziert werden | monotone Exposure-Guards | Senkung einer bestehenden Reservierung wird abgewiesen | Bestanden |
| Kumulative Budgetbewegung bleibt bei höchstens 20 % je 24 Stunden | Planner und Executor-Pre-Dispatch gegen append-only Ledger | `2.000 → 1.600` exakt zulässig; weitere `1` Minor Unit wird direkt vor Dispatch blockiert | Bestanden |
| Cooldown beträgt mindestens zwölf Stunden | Planner und Executor gegen letzte erfolgreiche Mutation/Ledger | Eine Millisekunde vor `43.200` Sekunden blockiert; am Grenzwert passiert der Plan das Gate | Bestanden |
| Kampagnen- und Ad-Set-Budget werden nicht gleichzeitig mutiert | kanonischer `budget_owner_key` und Target-Vertrag | Planner-/Target-Constraints und Sharing-Snapshot-Driftprüfung | Bestanden |
| Gleichzeitige Read-/Write-Operationen desselben Werbekontos sind ausgeschlossen | `meta_account_operation_leases` | Überlappende Lease wird abgewiesen; falsches Token kann weder erneuern noch freigeben | Bestanden |
| Ein Plan kann nicht durch Retry doppelt materialisiert werden | SHA-256-Idempotenzschlüssel und Unique-Constraint | Planner-Replay und Launch-Replay liefern denselben Plan | Bestanden |
| Ein unbekanntes Remote-Ergebnis löst keinen zweiten POST aus | persistenter Dispatch-State `AMBIGUOUS`, Probe-READ und Reconciliation | Zweiter Dispatch wird abgewiesen; Read-back reconciliert ohne Duplikat | Bestanden |
| Vorzustandsdrift blockiert vor Ausführung | Target-/Snapshot-Vergleich beim Execution-Claim | Staler Budgetplan endet als `STALE/before_state_drift` ohne Execution | Bestanden |
| Jede erfolgreiche Mutation benötigt Read-after-write | Saga-Step-Abhängigkeiten und Reconciliation-RPC | Budget-, Status- und vollständige Launch-Saga prüfen Remote-Snapshot vor Abschluss | Bestanden |
| Reconciliation-Mismatch bleibt fail-closed | Reconciler, Accountstatus und Kill-Switch-Eskalation | Runtime-Executor testet `MISMATCH`; Launch-/Budget-SQL prüft fehlende kanonische Zustände | Bestanden |
| Active-Launch kann keine teilweise ausliefernde Kette hinterlassen | 20-Schritt-Saga, transiente `PAUSED`-Eltern, finale Aktivierung, PAUSE-Kompensation | Vollständige Kampagne/Ad Set/Creative/Ad-Kette wird ausgeführt und projiziert; Domain- und Cap-Fehler hinterlassen keinen Teilplan | Bestanden |
| Browser kann privilegierte Mutations-RPCs nicht ausführen | RLS, Spaltengrants, `service_role`-only EXECUTE | Authenticated-Grants für Control Plane, Executor und Reconciler werden negativ geprüft | Bestanden |
| Fremdtenant-Daten und Snapshots bleiben unsichtbar | Tenant-Trigger, Foreign-Key-Gates und RLS | Cross-Tenant-Inserts und Reads werden abgewiesen | Bestanden |
| Audit ist unveränderlich, verkettet und secret-sanitized | append-only `mutation_audit_events` mit Sequenz und SHA-256 | Kettenkontinuität, Secret-Key-Abweisung und Update-Verbot werden geprüft | Bestanden |
| Kill-Switch ist append-only und nach Scope priorisiert | `kill_switch_state` und `get_effective_meta_kill_switch` | Account- und System-Scope, Priorität, Delete-Verbot und Kundenkommando werden geprüft | Bestanden |
| Schreiben erfordert minimalen Scope und konkretes Werbekonto | OAuth-Callback, gespeicherte granulare Targets, Service-, DB- und Executor-Gates | Ohne `ads_management` sind aktive Policy und `ALLOW` gesperrt; Not-Aus bleibt verfügbar | Bestanden |
| Reconnect löscht keine Historie | atomarer Connector-Upsert | Separate Fresh-Cluster-Reconnect-Regression bewahrt Connector-ID, Baseline, Assets und Inhalte | Bestanden |

## 3. Fail-closed Zustandsmodell

Ein Fehler wird nicht in einen impliziten Erfolg oder eine unkontrollierte Wiederholung übersetzt. Jeder kritische Zustand besitzt einen expliziten, persistenten Ausgang.

| Ereignis | Persistenter Zustand | Zulässige Folgeaktion |
|---|---|---|
| Kundenpolicy fehlt oder ist inaktiv | `BLOCKED/POLICY` | Kunde vervollständigt und bestätigt eine neue Policyversion |
| `ads_management` oder granulare Accountfreigabe fehlt | `BLOCKED/CONNECTOR` | Expliziter Meta-Reconnect mit Re-Authorization |
| Kill-Switch ist nicht `ALLOW` | `BLOCKED/KILL_SWITCH` | Keine Remote-Mutation; Not-Aus bleibt bedienbar |
| Lokaler Vorzustand driftet | `STALE/PREFLIGHT` | Neuer Read-Snapshot und neue Planung |
| Cooldown, 20-Prozent-Grenze oder Hard-Cap scheitert | Kein Dispatch | Später vollständig neu planen; keinen alten Plan warten lassen |
| Remote-POST liefert unbekanntes Ergebnis | `AMBIGUOUS` beziehungsweise Reconciliation-Pfad | Zuerst Remote-READ; niemals blind erneut POSTen |
| Read-back stimmt nicht mit Plan überein | Mismatch/Suspendierung | Weitere Writes sperren und manuell untersuchen |
| Launch bricht nach Objekterstellung ab | `COMPENSATION_REQUIRED` | Betroffene verwaltete Objekte auf `PAUSED`; niemals automatisch löschen |

## 4. Reproduzierbarer Release-Nachweis

| Prüfung | Befehl | Erwartung |
|---|---|---|
| Gesamte Meta-Regression | `npm run test:meta-all` | Alle Teiltests grün |
| Lint | `npm run lint` | Keine ESLint-Fehler |
| TypeScript | `npx tsc --noEmit` | Keine Typfehler |
| Produktionsbundle | `npm run build` mit syntaktisch gültigen öffentlichen Supabase-Buildvariablen | Next.js-Build erfolgreich |
| Patchhygiene | `git diff --check` | Keine Whitespace-/Patchfehler |

Die Fresh-Cluster-Suite baut eine temporäre PostgreSQL-Instanz aus allen Migrationen auf. Damit werden nicht nur statische SQL-Texte, sondern Funktionskörper, Constraints, Trigger, Grants, RLS, Planmaterialisierung, Executor-Schritte, Reconciliation und Reconnect-Historie real ausgeführt.

## 5. Noch ausstehendes externes Staging-Gate

Der Repository-Nachweis autorisiert **keinen echten Meta-Write**. Ein externer Staging-Lauf benötigt eine explizite, kundenseitige Konto- und Budgetfreigabe sowie den interaktiven OAuth-Reconnect. Diese Schritte können nicht durch Tests oder durch eine interne Service-Role ersetzt werden.

| Reihenfolge | Externes Gate | Abnahmekriterium |
|---:|---|---|
| 1 | Meta App Review und geeigneter Marketing API Access Tier | `ads_management` ist für den vorgesehenen Kundeneinsatz freigegeben |
| 2 | Expliziter Reconnect im Dashboard | Scope gespeichert; granulare Werbekonto-ID entspricht dem gewählten Stagingkonto |
| 3 | EUR-Stagingkonto und Kundenlimits | Account- und Kampagnen-Tagescap sind klein, positiv und bestätigt |
| 4 | Brand, Domain und Blueprint | Aktive Brandversion, verifizierte HTTPS-Domain und vollständiger Ziel-Blueprint |
| 5 | Kill-Switch-Startzustand | Zunächst `FREEZE_WRITES`; erst unmittelbar vor dem kontrollierten Versuch `ALLOW` |
| 6 | Einzelner Low-Budget-Test | Genau ein freigegebener Plan; keine parallele Read-/Write-Lease |
| 7 | Abschlussprüfung | Meta-Read-back, lokale Projektion, Exposure, Ledger und Audit-Hashkette stimmen überein |
| 8 | Rückkehr in sicheren Zustand | Nach dem Versuch `FREEZE_WRITES`, bis das Ergebnis abgenommen ist |

## 6. Aussagegrenze

Die Regression beweist die internen Sicherheitsverträge des Repositorys. Sie kann weder Metas tatsächlichen App-Review-Status noch externe Kontokonfiguration, aktuelle Werberichtlinien, Abrechnung oder das Verhalten eines realen Meta-Stagingkontos beweisen. Deshalb bleibt die Produktionsfreigabe bis zum kontrollierten externen Staging-Lauf gesperrt.

> **Releaseentscheidung:** Der Code- und Datenbankvertrag erfüllt die internen No-Overrun-, Idempotenz-, Reconciliation-, Audit-, Tenant- und Kill-Switch-Abnahmekriterien. Ein echter Meta-Write ist weiterhin ein separates, explizit freizugebendes Staging-Ereignis.
