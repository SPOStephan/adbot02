# Kontrollierter Meta-Staging-Test

**Stand:** 30. Juli 2026

**Status:** Minimaler Schreibscope verifiziert; reale Meta-Mutation bleibt blockiert, bis Testparameter, Readiness-Objekte, Kunden-Policy und `ALLOW` ausdrücklich bestätigt sind.

## Zweck und Sicherheitsgrenze

Dieser Lauf verifiziert eine vollständige Meta-Objektkette, konservative Hard-Cap-Reservierung, Budgetgrenzen, Remote-Read-back, Reconciliation, Idempotenz und Kill-Switch ausschließlich im geschützten Staging. Der Lauf darf erst beginnen, wenn das ausgewählte Werbekonto den minimalen Scope `ads_management` besitzt und eine explizit bestätigte Staging-Policy aktiv ist. Ohne diese Voraussetzungen werden keine Meta-Objekte angelegt, verändert oder aktiviert.

> **Fail-closed:** Der aktuelle Zustand ist trotz verifiziertem Minimal-Scope absichtlich nicht schreibfähig. Der Cron-Executor ist bereitgestellt, kann aber ohne aktive kundenbestätigte Policy, vollständige Readiness, aktuellen Exposure-Snapshot, ausführbaren Plan und ausdrückliches `ALLOW` keinen Remote-Write claimen.

## Verifizierter Preflight

| Prüfpunkt | Staging-Befund | Gate |
|---|---|---|
| Verbundenes Meta-Konto | Genau ein aktives Konto, Anzeigenkonto `1043…6209` | bestanden |
| Kontowährung | `EUR` | bestanden |
| Kontostatus | Meta-Status `1` | bestanden |
| Zeitzone | `Europe/Berlin` | bestanden |
| Marketing-Sync | `success`, letzter Erfolg 29.07.2026 07:40 UTC | bestanden |
| OAuth-Scopes | `ads_management`, `ads_read`, `instagram_basic`, `pages_read_engagement`, `pages_show_list`; Datenzugriff aktuell | bestanden |
| Aktive aktuelle Policy | 0 | blockiert |
| Claimbare oder laufende Pläne | 0 | sicher |
| Laufende Executions | 0 | sicher |
| Exposure-Reservierungen | 0 | sicher |
| Verifizierte Domains | 0 | blockiert für neue Objektkette |
| Aktive Ziel-Blueprints | 0 | blockiert für neue Objektkette |
| Freigegebene Brand-Assets | 0 | blockiert für neue Objektkette |
| Kill-Switch | `FREEZE_WRITES` | sicher |
| Auditereignisse | 0 | erwarteter Ausgangszustand |

Das Dashboard und die autoritative Staging-Abfrage zeigen denselben Zustand: **Minimaler Schreibscope bestätigt**, **Autonomie aus**, null Readiness-Objekte und den fail-closed Kill-Switch **Writes einfrieren**. Die Datenbank bestätigt zusätzlich ein aktuelles EUR-Konto mit Meta-Status `1`, erfolgreichen Marketing-Sync, null aktive Policy, null nichtterminale Pläne und null nichtterminale Asset-Jobs. Der Reconnect hat keine Remote-Mutation und kein Auditereignis ausgelöst.

## Erforderlicher kontrollierter Ablauf

| Reihenfolge | Aktion | Verantwortlich | Erwarteter Nachweis |
|---:|---|---|---|
| 1 | Meta über den geschützten Dashboard-Link neu verbinden und `ads_management` ausdrücklich bestätigen | Kunde | **Erledigt:** Scope gespeichert; bestehende Historie unverändert |
| 2 | Genau dieses EUR-Testkonto und ein enges Testfenster bestätigen | Kunde/Operator | dokumentierter Testscope |
| 3 | Test-Domain verifizieren, Ziel-Blueprint aktivieren und vorhandenes Brand-Asset freigeben | Server-API unter Kundenkontext | drei Readiness-Gates grün |
| 4 | Kleine Account- und Kampagnen-Tagescaps bestätigen; `FREEZE_WRITES` bleibt zunächst bestehen | Kunde | neue auditierte Policyversion, noch kein Claim |
| 5 | Dry Preflight und Meta-`validate_only` für die vollständige Kette ausführen | Executor | keine Remoteobjekte, alle Fingerprints gültig |
| 6 | Kill-Switch gezielt auf `ALLOW` setzen und genau einen idempotenten Launch-Plan materialisieren | Kunde/Operator | genau ein Plan und eine konservative Exposure |
| 7 | Kampagne und Ad Set als `PAUSED`, Creative und Ad gebunden anlegen; Eltern erst nach Read-back aktivieren | Executor | 20 geordnete Schritte, keine ungebundene Auslieferung |
| 8 | Remotezustände zurücklesen und lokale Projektionen, Bindings, Targets sowie Exposure kanonisieren | Reconciler | `SUCCEEDED` nur bei vollständigem Soll/Ist-Gleichstand |
| 9 | Identischen Materializer-Aufruf wiederholen | Operator | derselbe Plan, keine zweite Exposure, keine Doppelobjekte |
| 10 | Kontrollierte Budgetgrenze und 20-Prozent-/12-Stunden-Gates prüfen | Operator | Grenzwert erlaubt; Überschreitung und Cooldown blockiert |
| 11 | Kill-Switch auf `PAUSE_MANAGED` setzen und Remote-Read-back ausführen | Kunde/Operator | verwaltete Kette sicher pausiert und auditiert |
| 12 | Kill-Switch auf `FREEZE_WRITES` zurücksetzen | Kunde/Operator | keine weiteren normalen Claims möglich |

## Abbruchbedingungen

Der Lauf wird vor dem nächsten Meta-Write beendet, wenn Scope, Accountbindung, Währung, Tokenzustand, Domain, Blueprint, Asset, Policyhash, Snapshot, Budgetebene, Exposure, Cooldown oder Remote-Before-State nicht eindeutig sind. Ein ambiges Create wird niemals blind wiederholt. Bei einer teilweise angelegten Kette bleiben Eltern `PAUSED`; bei möglicher Auslieferung wird ausschließlich der idempotente Safety-Pause-Pfad verwendet. Automatische Löschungen sind ausgeschlossen.

## Nächstes manuelles Gate

Vor dem ersten Remote-Write müssen der Kunde beziehungsweise Operator **konkrete Testparameter** bestätigen: Account-Tagescap, Kampagnen-Tagescap, Landingpage, Ziel/Objective, Region und Zielgruppe sowie die zu verwendende Brand-Quelle. Danach werden Domain, Blueprint, Brand-Profil und Asset noch bei aktivem `FREEZE_WRITES` vorbereitet. Erst wenn diese Readiness-Gates grün sind, darf eine neue Policyversion bestätigt werden.

Die anschließende Änderung von `FREEZE_WRITES` auf `ALLOW` und die Materialisierung genau eines Launch-Plans sind ein separates, ausdrücklich angekündigtes Gate. Der Executor darf erst danach laufen. Wenn kein echtes, eng begrenztes Testobjekt akzeptiert wird, endet Phase 15 am vollständig bestandenen Preflight und es erfolgt **kein** Meta-Write.
