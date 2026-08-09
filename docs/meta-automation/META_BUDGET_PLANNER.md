# Deterministischer Meta-Budgetplanner

Der Budgetplanner übersetzt einen erfolgreich und atomar persistierten Meta-Marketing-Snapshot in unveränderliche, noch nicht remote ausgeführte Mutationspläne. **PostgreSQL ist die maßgebliche Sicherheitsinstanz** für Kundenlimits, Flexspend-Exposure, Cooldown, rollierende Budgetbewegung, Idempotenz und Kill-Switch-Präzedenz. Der TypeScript-Orchestrator übergibt lediglich den exakt gelesenen Snapshot und führt keine eigene Budgetentscheidung aus.

## Geordneter Kontrollpfad

Marketing-Snapshot und Planner laufen unter derselben exklusiven Werbekonto-Lease vom Typ `READ_SYNC`. Ein späterer Executor muss dieselbe Lease-Tabelle mit `WRITE_EXECUTION` verwenden. Dadurch können Read-Sync und Remote-Mutation auf einem Werbekonto nicht gleichzeitig laufen.

| Reihenfolge | Operation | Sicherheitswirkung |
|---:|---|---|
| 1 | `claim_meta_account_operation(..., 'READ_SYNC', ..., 900)` | Sperrt parallele Write-Ausführung für das Werbekonto. |
| 2 | Meta-Marketingdaten vollständig lesen und `replace_meta_marketing_snapshot` atomar persistieren | Erzeugt einen eindeutigen, unveränderlich referenzierten `marketing_sync_id`. |
| 3 | `record_meta_campaign_budget_sharing_snapshot` | Bindet jeden Campaign-Sharing-Wert, einschließlich explizitem `NULL`, an exakt diesen Snapshot. |
| 4 | `run_meta_budget_planner` | Berechnet Exposure und erzeugt idempotente `PENDING`-Pläne ohne Remote-Mutation. |
| 5 | `release_meta_account_operation` | Gibt das Werbekonto frei; ein Releasefehler wird als sicherer Plannerfehler protokolliert und die Lease läuft spätestens nach 900 Sekunden ab. |

> **Fail-closed:** Ist die Account-Lease belegt, die Policy inaktiv, der Snapshot unvollständig oder eine Sicherheitsinvariante nicht beweisbar, wird keine Budgetmutation geplant.

## Konservative Tagesexposure

Für jeden aktuellen Budgetowner wird ein Tageswert in Minor Units berechnet. Bei bestätigtem, deaktiviertem Campaign-Budget-Sharing beträgt der Mindestfaktor `1,75` (Metas dokumentiertes Tages-Overspend-Maximum von +75 %). Bei aktivem oder unbekanntem Sharing beträgt er mindestens `2,10`. Das ist **nicht** die autonome Budget-*Änderungs*-Grenze von 20 % / 24 h (`budget_change_limit_bps`). Tageswerte dürfen innerhalb desselben Werbekonto-Tages nur steigen; ein später kleinerer Snapshot kann bereits reservierte Exposure nicht freigeben.

| Größe | Berechnung |
|---|---|
| Owner-Exposure | `ceil(Tagesbudget × Flexspend-Faktor / 10.000)` |
| Account-Exposure | Summe aller aktuellen Owner-Exposures des Werbekontos |
| Account-Gate | Account-Exposure darf das kundenseitige Account-Tageslimit nicht überschreiten. |
| Campaign-Gate | Campaign-Exposure darf das kundenseitige Kampagnen-Tageslimit nicht überschreiten. |
| Shared-/Unknown-Gate | Faktor darf bei aktivem oder unbekanntem Sharing nicht unter `21.000` Basispunkte fallen. |

Der Planner modelliert damit **eine konservative Budgetexposure**, keine nachträgliche Spend-Schätzung. Vor jeder späteren Remote-Mutation muss der Executor dieselbe Prüfung atomar wiederholen und reservieren.

## Budgetregeln

Eine Budgetänderung verwendet immer das aktuell synchronisierte Budget als Ausgangswert. Der maximal mögliche Schritt beträgt 20 Prozent. Die Summe der absoluten, bereits reconcilierten Bewegungen der letzten 24 Stunden darf ebenfalls 20 Prozent des ersten Budgets im Fenster nicht überschreiten. Nach einer ausgeführten Budgetänderung gilt ein Cooldown von zwölf Stunden.

| Regel | Planneraktion | Zusätzliche Bedingungen |
|---|---|---|
| `spend_without_results_7d` | Budget um 20 % senken | Aktuelle Empfehlung aus demselben Snapshot; Mindestdaten bereits durch die Recommendation Engine belegt. |
| `cost_per_result_up_30pct` | Budget um 20 % senken | Aktuelle Empfehlung aus demselben Snapshot. |
| `cost_per_result_down_15pct` | Budget um 10 % erhöhen | Je mindestens fünf Ergebnisse in beiden Siebentagesfenstern; Kosten je Ergebnis mindestens 15 % besser. |
| Hard-Cap-Verletzung | Aktive MANAGED-Kampagnen pausieren, **außer Beitrag-Push** (`organic-boost`) | Sicherheitspfad über **Exposure** (`Tagesbudget × Flexfaktor`), nicht über beobachteten Spend. Beitrag-Push bleibt mid-flight ACTIVE; neue Launches bleiben über Preflight am Hard-Cap geblockt. |
| Neuer Werbekonto-Tag unter Cap | Zuvor per Hard-Cap `SAFETY_PAUSE`te MANAGED-Kampagnen wieder `ACTIVATE` (`safety_action`) | PAUSED Owner werden am neuen Tag nicht erneut in die SNAPSHOT-Exposure aufgenommen; Same-Day-Reserve bleibt erhalten. `mutation_plans_safety_type_check` erlaubt `safety_action` für `SAFETY_PAUSE` und `ACTIVATE`. |

Jeder Budgetplan besitzt die vier ausführbaren Schritte `VALIDATE_REMOTE`, `UPDATE_BUDGET`, `READ_AFTER_WRITE` und `RECONCILE`. Ein Sicherheitspausenplan besitzt `VALIDATE_REMOTE`, `UPDATE_STATUS`, `READ_AFTER_WRITE` und `RECONCILE`. Planneroutput ist idempotent über Policy, Marketing-Snapshot, Target, Regel und Regelversion.

## Snapshot- und Driftregeln

Der Campaign-Sharing-Vektor muss exakt so viele eindeutige, numerische Campaign-IDs enthalten wie der Marketing-Snapshot aktuelle Kampagnen besitzt. Derselbe `marketing_sync_id` darf nicht später mit einem anderen Sharingwert wiederholt werden. Noch nie geclaimte Pläne älterer Snapshots werden beim nächsten erfolgreichen Plannerlauf `STALE`; bereits beanspruchte oder remote möglicherweise ausgeführte Pläne bleiben für Reconciliation erhalten.

| Plannerstatus | Bedeutung |
|---|---|
| `READ_LEASE_REQUIRED` | Aufruf erfolgte nicht unter der passenden aktiven `READ_SYNC`-Lease. |
| `NO_ACTIVE_POLICY` | Keine kundenseitig bestätigte aktive Autonomiepolicy vorhanden. |
| `NO_BUDGET_OWNERS` | Snapshot enthält keine aktuellen Tagesbudgetowner. |
| `HARD_CAP_SAFETY` | Exposure verletzt ein Kundenlimit; Sicherheitspausen wurden geplant. |
| `PLANNED` | Exposure ist zulässig; deterministische Budgetkandidaten wurden erstellt, wiedergefunden oder blockiert. |

## Betriebsmetadaten

`platform_accounts` speichert ausschließlich nicht-sensitive Planner-Metadaten: letzten Status, sicheren Fehlercode, Zeitpunkt des letzten Versuchs und Erfolgs sowie den konsumierten Marketing-Snapshot. Browserrollen dürfen nur diese Spalten lesen. Planner-, Sharing- und Lease-RPCs bleiben ausschließlich für `service_role` ausführbar.

## Reproduzierbare Prüfungen

```bash
npm run test:meta-budget-planner
npm run test:meta-content-sync
npm run test:meta-marketing-sync
npm run test:meta-write-control-plane
npm run test:meta-marketing-readonly
npm run lint
npx tsc --noEmit
```

Der Fresh-Cluster-Test startet einen temporären PostgreSQL-Cluster, spielt Bootstrap und alle Migrationen in Produktionsreihenfolge ein und prüft unter anderem `1,75`-/`2,10`-Exposure, Tagesmonotonie, Hard Caps, 20-Prozent-Fenster, zwölfstündigen Cooldown, Snapshotdrift, Planidempotenz, RLS, RPC-Grants und Auditverkettung.
