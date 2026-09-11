# Adbot.one – System-Integritätsprüfung

**Prüfdatum:** 10. September 2026  
**Repository:** `SPOStephan/adbot02`  
**Ausgangsbasis:** `main` nach Meta-Hotfix PR #225 (`194c2cdbeaa58eedee63e318e6644b837187c3bb`)  
**Prüfbranch:** `fix/system-integrity-hardening`

## Executive Summary

Die bestehende Meta-Verbindung des Accounts `marketing@lohbeck-privathotels.de` ist im Live-System wiederhergestellt und wurde im eingeloggten Browser erneut bestätigt. Das Dashboard zeigte am Ende der Prüfung **„Meta Live“**, **„Meta Ads – Verbunden“** und den Datenstand **10.09.2026, 12:01**. Die zuvor sichtbaren Fehlertexte zur nicht ladbaren Live- beziehungsweise Verbindungsdatenabfrage waren nicht mehr vorhanden. Der öffentliche Health-Endpunkt antwortete mit HTTP 200.

Die ursprüngliche Störung wurde nicht durch das Löschen oder Widerrufen eines Meta-Tokens verursacht. Der gemeinsame Dashboard-Select hatte neue, noch nicht in der Live-Datenbank vorhandene OpenAI-Provider-Spalten vorausgesetzt. Dadurch scheiterte die gesamte Plattformkonto-Abfrage und die Oberfläche stellte eine funktionierende Meta-Verbindung fälschlich als nicht verfügbar dar. PR #225 entkoppelte den Meta-Basisquery wieder vom OpenAI-Schema.

Der anschließende vollständige Integritätscheck fand weitere verdeckte Schwachstellen und inkonsistente historische Testverträge. Die produktionsrelevanten Schwachstellen wurden auf dem Prüfbranch behoben; sämtliche vorhandenen Meta-Tests, die OpenAI-Ads-Tests, Fresh-Database-Tests, der Produktions-Build, TypeScript, ESLint und der Dependency-Audit laufen anschließend erfolgreich.

> **Wichtige Rolloutgrenze:** Die zusätzlichen Härtungen dieses Berichts sind noch nicht live. Insbesondere wurde keine Datenbankmigration auf das Live-Supabase-Projekt angewendet. Das öffentliche Bundle verweist auf das Supabase-Projekt `aalmikwjyhdcmfeblofn`; dieses Projekt ist über den aktuell verbundenen Supabase-MCP-Zugang nicht sichtbar. Zur Vermeidung jeder Verwechslung wurde keine andere Datenbank verändert.

## Live-Verifikation

| Prüfung | Ergebnis | Status |
|---|---|---|
| Eingeloggtes Dashboard des betroffenen Accounts | „Meta Live“ und „Verbunden“ sichtbar | Bestanden |
| Fehler „Live-Daten konnten nicht geladen werden“ | Nicht mehr sichtbar | Bestanden |
| Fehler „Verbindungsdaten konnten nicht geladen werden“ | Nicht mehr sichtbar | Bestanden |
| Sichtbarer Datenstand | 10.09.2026, 12:01 | Bestanden |
| `https://app.adbot.one/api/health` | HTTP 200, `application/json`, `no-store` | Bestanden |
| Live-ChatGPT-Ads-Seite vor Härtungsdeployment | Next.js-Fehlerseite bei fehlender DB-/Secret-Konfiguration | Bestätigter Restfehler; im Prüfbranch behoben |
| Direkter Live-Datenbankcheck | Nicht möglich, da das tatsächlich verwendete Projekt nicht im verbundenen Supabase-Zugang vorhanden ist | Offene Betriebsabhängigkeit |

## Gefundene und behobene Integritätsprobleme

| Priorität | Befund | Korrektur im Prüfbranch |
|---|---|---|
| Kritisch | Gemeinsame Plattformqueries konnten bestehendes Meta durch noch nicht migrierte OpenAI-Spalten vollständig unlesbar machen. | Meta-Basisdaten und provider-spezifischer Status werden getrennt geladen. Der generische Connector-Endpunkt verwendet nur den stabilen Basisspaltenvertrag. |
| Hoch | Die ChatGPT-Ads-Seite stürzte bei fehlender Live-Migration oder fehlendem Verschlüsselungs-Key als Serverfehler ab. | Fail-closed Fallbackseite mit klarer Konfigurationsmeldung; kein Connector- oder Launchformular ohne vollständige Konfiguration. |
| Hoch | Der OpenAI-ACTIVE-Launch versprach ein nicht in der offiziellen Provider-API belegtes Kampagnen-Tageslimit. | ACTIVE-Launch server- und UI-seitig gesperrt; undokumentiertes Providerfeld entfernt. Connect, Read-Sync und Reporting bleiben separat nutzbar. |
| Hoch | Partiell erstellte OpenAI-Objekte konnten bei Fehlern unvollständig zurückgerollt werden. | Vollständiger Best-Effort-Pauseversuch für Anzeige, Anzeigengruppe und Kampagne mit anschließendem Read-back; Besitzprüfung erfolgt vor lokaler Persistenz. |
| Hoch | OpenAI-Conversion-Insights wurden für mehrtägige Abfragen potentiell einem falschen Tag zugeordnet. | Abruf pro Tagesbucket; unvollständige Attribution bricht den Snapshot fail-closed ab, statt falsche Nullwerte zu persistieren. |
| Hoch | Mehrere browsergesteuerte Meta-Mutationsrouten hatten keinen einheitlichen Same-Origin-Schutz. | Gemeinsamer Origin-/`Sec-Fetch-Site`-Guard für Reconnect, Disconnect, Sync, Assetauswahl, Prune und Upload; Regressionstest für alle geschützten Routen. |
| Hoch | Auth-Weiterleitungen akzeptierten nicht ausreichend normalisierte `next`-Ziele. | Gemeinsamer strikter Same-Origin-Pfadnormalisierer gegen protocol-relative, Backslash- und kodierte Slash-Varianten. |
| Hoch | Ein späterer DB-Change hatte den erlaubten Same-Day-Rebind von Budget-Exposure-Snapshots wieder überschrieben. | Forward-Migration vereinigt den sicheren Snapshot-Rebind mit dem Organic-Boost-Sonderfall; Fresh-PostgreSQL-Regression bestanden. |
| Hoch | Der Creative-Asset-Upsert verwendete `ON CONFLICT (platform_account_id, sha256)`, nachdem nur noch ein nicht passender partieller Unique-Index vorhanden war. | Regulärer accountbezogener Unique-Index als Konflikt-Arbiter wiederhergestellt; Creative-Completion im vollständigen DB-Test ausgeführt. |
| Hoch | Eine erneuerte oder widerrufene Meta-Autorisierung konnte einen alten erfolgreichen Marketing-Snapshot und ausführbare alte Pläne behalten. | Trigger invalidiert Marketing-Readiness und markiert nichtterminale Pläne des alten Syncs als `STALE`; aktive Credentials werden nicht gelöscht. |
| Mittel | Browserrolle konnte durch späteren Tabellen-Grant interne Mutation-Payloadspalten lesen. | Spaltenbegrenzter `SELECT`-Vertrag wird in einer Forward-Migration erneut explizit hergestellt. |
| Mittel | Abgewiesene oder nicht mehr entschlüsselbare OpenAI-Credentials konnten weiterhin vom Cron wiederholt werden. | Credential-Retirement bei Auth-/Decrypt-Fehlern und Stop weiterer automatischer Wiederholungen. |
| Mittel | OpenAI-Sync konnte mit mehreren Konten und Einzelrequest-Timeouts das Serverless-Gesamtbudget überschreiten. | Ein Konto pro Cronlauf und gemeinsame harte Deadline mit Reserve für kontrollierte Fehlerpersistenz. |
| Mittel | Abhängigkeiten enthielten bekannte Advisories. | Next.js auf 16.3.4, Sharp auf 0.34.5, PostCSS auf 8.5.8 und `eslint-config-next` passend aktualisiert; `npm audit` meldet null Schwachstellen. |
| Mittel | Mehrere Regressionstests waren auf veraltete RPC-Signaturen, Navigation, Cronlisten oder Importstubs fest verdrahtet und verdeckten nachgelagerte Fehler. | Tests auf semantische Invarianten und final wirksame Signaturen aktualisiert; vollständiger ununterbrochener Lauf erfolgreich. |
| Niedrig | Repository-Lint enthielt zwölf Fehler sowie Warnungen. | Semantikneutrale Bereinigung beziehungsweise eng begründete lokale Ausnahmen; ESLint läuft ohne Fehler und Warnungen. |

## Verifikation

| Prüfschritt | Ergebnis |
|---|---|
| `npm run test:meta-all` | Bestanden; vollständiger ununterbrochener Lauf aller Meta-, Security-, UI-, Creative-, Launch- und Fresh-PostgreSQL-Tests |
| `npm run test:openai-ads` | Bestanden; Connectorvertrag und alle Migrationen/RLS-Prüfungen auf frischem PostgreSQL |
| Zusätzliche Planner-, Creative-, Assistant-, Pricing-, Funnel- und Domain-Tests | Bestanden |
| `npm run lint` | Bestanden; null Fehler, null Warnungen |
| `npx tsc --noEmit` | Bestanden |
| `npm run build` | Bestanden; optimierter Next.js-16.3.4-Produktions-Build |
| `npm audit --omit=dev` | Null bekannte Schwachstellen |
| `npm audit` | Null bekannte Schwachstellen |
| `git diff --check` | Bestanden |
| Secret-Scan der neu hinzugefügten Diffzeilen | Keine credentialförmigen Werte gefunden |

## Datenschutz und Änderungsgrenzen

Während der Integritätsprüfung wurden keine Meta-Verbindung, kein Meta-Token, keine Kampagne und keine Kundendaten im Live-System verändert. Die Live-Prüfungen waren read-only. Es wurde ausdrücklich keine Migration auf eines der sichtbaren, aber nicht eindeutig zuordenbaren Supabase-Projekte angewendet.

Die neue Forward-Migration ist additiv und löscht keine aktive Meta-Autorisierung. Sie bereinigt nur bereits widerrufene Konten und schützt künftige Autorisierungswechsel davor, alte Marketing-Snapshots oder laufende Mutation-Pläne weiterzuverwenden.

## Empfohlener Rollout

Der Prüfbranch sollte zunächst als Pull Request reviewed werden. Danach müssen Code-Deployment und Datenbankmigration als ein kontrollierter Live-Rollout behandelt werden, obwohl Adbot keine getrennten Staging- oder Testumgebungen verwendet. Vor der Migration ist das tatsächlich von `app.adbot.one` genutzte Supabase-Projekt `aalmikwjyhdcmfeblofn` eindeutig mit dem Supabase-Zugang zu verbinden. Anschließend sind Migration, Deployment, Health-Check, Login, Meta-Status, manuelle Meta-Synchronisation und ChatGPT-Ads-Fallback in genau dieser Reihenfolge zu prüfen.

Bis dieser Rollout abgeschlossen ist, darf der neue OpenAI-ACTIVE-Launch nicht freigegeben werden. Die Google-Ads-Implementierung sollte erst danach beginnen, damit keine weitere Providerarbeit auf ungeklärten Betriebszuständen aufsetzt.

## Ergebnis

Innerhalb des vollständig reproduzierbar geprüften Repository- und Browserumfangs bestehen nach den Korrekturen **keine bekannten offenen Code-, Test-, Build-, Dependency- oder Fresh-Database-Fehler**. Die verbleibende Unsicherheit liegt ausschließlich in der noch nicht zugänglichen Live-Supabase-Instanz und dem deshalb noch nicht durchgeführten Live-Rollout der neuen Forward-Migration und Fallbacks. Eine absolute Aussage, dass außerhalb der beobachtbaren und testbaren Grenzen keine verborgenen Fehler existieren, wäre technisch unseriös; der aktuelle Prüfstand reduziert dieses Risiko jedoch erheblich und macht die verbleibende Grenze explizit.
