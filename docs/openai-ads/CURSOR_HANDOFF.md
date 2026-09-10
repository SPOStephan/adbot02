# Cursor Handoff: ChatGPT Ads

**Branch:** `feature/openai-ads-connector`  
**Interner Provider-Key:** `openai_ads`  
**Dashboard:** `/dashboard/chatgpt-ads`

## Implementierter Umfang

Der Branch ergänzt einen produktionsnahen OpenAI-Ads-Connector auf Basis der offiziellen Advertiser API. Kunden können mehrere Werbekonten verbinden, weil jeder OpenAI-Ads-API-Key genau einem Ad Account zugeordnet ist. Der Key wird mit `GET /ad_account` verifiziert, danach per AES-256-GCM verschlüsselt und niemals an den Browser zurückgegeben.

Der Read-Sync lädt Konto, Kampagnen, Anzeigengruppen, Anzeigen und die letzten 30 Tage täglicher Kampagnen-Insights. Die Hierarchie wird erst nach vollständig erfolgreichem Abruf atomar gespeichert. Die Views `cross_platform_account_performance_daily` und `cross_platform_campaign_performance_30d` normalisieren Meta- und OpenAI-Ads-Metriken als Basis für spätere Budgetoptimierung.

Der Write-Flow folgt Betriebsmodell A. Nach einmaliger ausdrücklicher Bestätigung von Kampagne, Targeting, maximalem Tagesbudget, Laufzeitbudget und Maximalgebot erstellt er Kampagne, Anzeigengruppe und Chat-Card-Anzeige direkt `active`. Ist die Anzeige noch `in_review`, beginnt die Auslieferung nach OpenAIs Genehmigung automatisch. Bei Ablehnung oder technischem Teilfehler pausiert Adbot die bereits erzeugte Kette als definierten Rückfallzustand. Kann die Rücknahme nicht bestätigt werden, wird der Launch als `activation_uncertain` gekennzeichnet und verlangt sofortige manuelle Kontrolle im Ads Manager. Der Aktivierungsendpunkt bleibt ausschließlich zur Kompatibilität mit eventuell vorhandenen älteren PAUSED-Launchdatensätzen bestehen.

## Wichtige Dateien

| Bereich | Datei |
|---|---|
| Provider-Client | `src/lib/openai-ads/client.ts` |
| Credential-Verbindung | `src/lib/openai-ads/connection.ts` |
| Read-Sync | `src/lib/openai-ads/sync.ts` |
| ACTIVE-Launch/Sicherheits-Rollback | `src/lib/openai-ads/launch.ts` |
| Eingabevalidierung | `src/lib/openai-ads/input.ts` |
| Dashboard-Loader | `src/lib/openai-ads/dashboard.ts` |
| Kundenoberfläche | `src/app/dashboard/chatgpt-ads/page.tsx` |
| Datenbankmigration | `supabase/migrations/20260910100000_openai_ads_connector_foundation.sql` |
| Vertrags-/Security-Test | `scripts/test-openai-ads-connector.mjs` |
| Fresh-DB-Test | `scripts/test-openai-ads-database.mjs` und `scripts/test-openai-ads-connector.sql` |
| API-Vertrag und Quellen | `docs/openai-ads/OPENAI_ADS_CONNECTOR.md` |

## Erforderliche Umgebung

```dotenv
OPENAI_ADS_TOKEN_ENCRYPTION_KEY=<Base64-kodierter 32-Byte-Schlüssel>
# optional nur für kontrollierte Staging-/Mock-Umgebungen:
# OPENAI_ADS_API_BASE_URL=https://api.ads.openai.com/v1
```

Einen Schlüssel erzeugt beispielsweise `openssl rand -base64 32`. Er muss serverseitig in Vercel hinterlegt werden und ist ausdrücklich nicht `OPENAI_API_KEY`. Der Ads-Key des Kunden wird über die Dashboard-Oberfläche eingegeben, nicht als Deployment-Variable.

## Sicherer Rollout

1. Migration in Staging anwenden und `OPENAI_ADS_TOKEN_ENCRYPTION_KEY` in Staging setzen.
2. Anwendung deployen und `/dashboard/chatgpt-ads` öffnen.
3. Erstes OpenAI-Ads-Testkonto verbinden. Account-ID, Währung, Zeitzone, Accountstatus und Brand Review kontrollieren.
4. Manuellen Sync auslösen und Kampagnen-/Insightzahlen mit OpenAI Ads Manager vergleichen.
5. Ein dediziertes Testkonto ohne produktive Kampagnen verwenden. Im Launchformular expliziten Standort, minimales Tagesbudget, minimales Laufzeitbudget und Maximalgebot eintragen. Die Checkbox macht klar, dass der folgende Klick kostenwirksam sein kann.
6. „Kostenwirksam ACTIVE anlegen“ klicken und unmittelbar im OpenAI Ads Manager bestätigen, dass Campaign, Ad Group und Ad ACTIVE sind. Falls die Anzeige `in_review` ist, kann die Auslieferung direkt nach OpenAIs Genehmigung beginnen; deshalb die Limits bewusst klein halten.
7. Anzeigenprüfung und erste Delivery-Daten abwarten. Manuellen Sync auslösen und Reviewstatus, Spend, Impressionen, Klicks sowie Conversion-Verfügbarkeit mit dem Ads Manager vergleichen.
8. Zweites Konto über einen separaten accountbezogenen API-Key verbinden und Tenant-/Kontentrennung prüfen.
9. Erst nach Staging-Abnahme Migration, Secret und Deployment in Produktion übernehmen.

## Tests

```bash
npm run test:openai-ads
npx tsc --noEmit
npx eslint src/app/api/connectors/openai-ads src/app/api/cron/openai-ads-sync \
  src/app/api/openai-ads src/app/dashboard/chatgpt-ads src/components/OpenAIAds*.tsx \
  src/lib/openai-ads src/lib/platforms/credential-crypto.ts
npm run build
```

Der Fresh-DB-Test startet einen temporären lokalen PostgreSQL-Cluster, wendet sämtliche Migrationen an und prüft danach Mehrkonto-Eindeutigkeit, Meta-Singleton/Reconnect, atomaren OpenAI-Snapshot, kanalübergreifende Kennzahlen, RLS und den Entzug von Credential-Leserechten.

## Bewusste Grenzen

Die automatische kanalübergreifende Budgetumschichtung ist noch nicht freigeschaltet. Eine belastbare Optimierung benötigt mindestens zwei produktive Kanäle mit vergleichbarer Conversion-Definition, Währung, Attributionsfenster, Datenfrische und ausreichender Stichprobe. Der neue Connector liefert die normalisierte Datenbasis. Das kundenseitig bestätigte Tageslimit pro neuer OpenAI-Kampagne ist implementiert; ein zusätzliches accountweites Gesamt-Tageslimit gehört in die folgende providerübergreifende Autonomie-Policy und darf vor automatischer Umschichtung nicht fehlen.

Eine Trennung in Adbot entfernt das verschlüsselte Credential und lässt historische Reportings bestehen. Weil der Provider keinen Remote-Revoke über diesen Flow ausführt, soll der Kunde den Key zusätzlich im OpenAI Ads Manager widerrufen.
