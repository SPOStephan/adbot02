# Cursor Handoff: ChatGPT Ads

**Branch:** `fix/system-integrity-hardening`
**Interner Provider-Key:** `openai_ads`  
**Dashboard:** `/dashboard/chatgpt-ads`

## Sicherer aktueller Umfang

Der Connector unterstützt mehrere OpenAI-Ads-Werbekonten pro Adbot-Nutzer. Ein accountbezogener API-Key wird zuerst über `GET /ad_account` verifiziert, anschließend mit AES-256-GCM verschlüsselt gespeichert und nie an den Browser zurückgegeben. Der Read-Sync lädt Konto, Kampagnen, Anzeigengruppen, Anzeigen, Delivery-Insights und Conversion-Insights. Die lokale Hierarchie wird erst nach einem vollständigen Abruf atomar ersetzt.

Conversion-Antworten enthalten laut offizieller Referenz kein Datum. Der Sync führt deshalb pro vorhandenem Tagesbucket einen separaten Conversion-Request aus und versieht die Antwort mit dem Datum dieses Requestfensters. Scheitert ein erforderlicher Conversion-Request, wird kein Teil-Snapshot geschrieben. Die providerneutralen Views `cross_platform_account_performance_daily` und `cross_platform_campaign_performance_30d` bilden die Grundlage für spätere kanalübergreifende Optimierung.

**Kostenwirksame ACTIVE-Launches sind derzeit absichtlich gesperrt.** OpenAI dokumentiert ein Lifetime-Limit pro Kampagne, das Daily-Spend-Limit jedoch kontoweit und revisionsgebunden. Der bisher angenommene Campaign-Parameter war nicht dokumentiert und wurde aus dem Providerpayload entfernt. UI und API bleiben geschlossen, bis eine Produktentscheidung zur kontoweiten Wirkung und ein verifizierter Read-back umgesetzt sind. Der vorbereitete Fehlerpfad pausiert alle vorhandenen Remoteobjekte unabhängig und akzeptiert einen sicheren Rollback nur nach bestätigtem `paused`-Read-back.

## Integrität und Kompatibilität

Die gemeinsame Dashboard- und Connectorstatus-Abfrage liest ausschließlich alte, migrationsunabhängige Plattformkonto-Spalten. OpenAI-spezifische Statusfelder werden separat und nur dann geladen, wenn ein OpenAI-Konto tatsächlich vorhanden ist. Fehlt die Live-Konfiguration oder das Zielschema, rendert die ChatGPT-Ads-Seite einen kontrollierten Nicht-verfügbar-Zustand statt einer Next.js-Fehlerseite. Der Cron überspringt einen nicht konfigurierten Connector erfolgreich, verarbeitet höchstens ein Konto pro Lauf und reserviert 30 Sekunden für kontrollierte Fehlerpersistenz.

Die Forward-Migration `20260910115500_system_integrity_forward_fixes.sql` invalidiert bei jedem Meta-Reconnect oder geänderten Ad-Account-Grant die alte Marketing-Readiness und markiert darauf basierende offene Mutation-Pläne als `STALE`. Sie wiederholt außerdem eine nachträglich korrigierte historische Funktionsdefinition unter einer neuen Versionsnummer und stellt die browserseitigen Spaltengrants für `mutation_plans` explizit wieder her. Bereits veröffentlichte Migrationen dürfen künftig nicht rückwirkend verändert werden.

## Wichtige Dateien

| Bereich | Datei |
|---|---|
| Provider-Client und Deadline | `src/lib/openai-ads/client.ts` |
| Credential-Verbindung | `src/lib/openai-ads/connection.ts` |
| Read-/Conversion-Sync | `src/lib/openai-ads/sync.ts` |
| Vorbereiteter Launch und verifizierter Rollback | `src/lib/openai-ads/launch.ts` |
| Dashboard-Fallback | `src/app/dashboard/chatgpt-ads/page.tsx` |
| Provider-Basismigration | `supabase/migrations/20260910100000_openai_ads_connector_foundation.sql` |
| Forward-Integritätsmigration | `supabase/migrations/20260910115500_system_integrity_forward_fixes.sql` |
| Connector-/Security-Test | `scripts/test-openai-ads-connector.mjs` |
| Fresh-DB-/RLS-Test | `scripts/test-openai-ads-database.mjs` und `scripts/test-openai-ads-connector.sql` |
| API-Vertrag und Quellen | `docs/openai-ads/OPENAI_ADS_CONNECTOR.md` |

## Direkter Live-Rollout ohne Staging

Adbot besitzt nur das Live-System. Trotzdem gilt eine feste technische Reihenfolge: zuerst beide noch nicht angewendeten OpenAI-/Forward-Migrationen auf der tatsächlichen Live-Datenbank ausführen, danach den Code deployen und erst anschließend `OPENAI_ADS_TOKEN_ENCRYPTION_KEY` setzen. Solange der Schlüssel fehlt, bleibt der Connector kontrolliert deaktiviert. Das Live-Projekt aus dem ausgelieferten Browserbundle verwendet die Supabase-Referenz `aalmikwjyhdcmfeblofn`; dieses Projekt ist im aktuell verbundenen Supabase-MCP nicht verfügbar, daher darf keine der drei anderen sichtbaren Datenbanken ersatzweise migriert werden.

Nach der Konfiguration wird zuerst ein Werbekonto verbunden und ausschließlich der Read-Pfad geprüft: Account-ID, Währung, Zeitzone, Accountstatus, Brand Review sowie Delivery- und Conversionwerte müssen mit dem Ads Manager übereinstimmen. Ein zweites Konto kann danach getrennt angebunden und auf Mandanten-/Kontotrennung geprüft werden. Der ACTIVE-Launch bleibt dabei gesperrt.

## Verifikation

```bash
npm run test:openai-ads
npm run test:meta-all
npx tsc --noEmit
npm run lint
npm run build
npm audit --omit=dev
```

Der Fresh-DB-Test startet einen temporären PostgreSQL-Cluster, wendet sämtliche Migrationen in Reihenfolge an und prüft Mehrkonto-Eindeutigkeit, Meta-Singleton/Reconnect, Snapshot-Invalidierung, atomaren OpenAI-Snapshot, kanalübergreifende Kennzahlen, RLS und Credential-Leserechte.

## Bewusste Grenzen

Die automatische kanalübergreifende Budgetumschichtung bleibt gesperrt, bis mindestens zwei produktive Kanäle vergleichbare Conversiondefinitionen, Währungen, Attributionsfenster, aktuelle Daten und ausreichende Stichproben liefern. Eine Trennung in Adbot entfernt das verschlüsselte Credential und bewahrt historische Reportings; der Kunde soll den API-Key zusätzlich im OpenAI Ads Manager widerrufen.
