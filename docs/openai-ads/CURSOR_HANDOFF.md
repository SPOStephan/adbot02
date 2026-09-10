# Cursor Handoff: ChatGPT Ads

**Branch:** `feature/openai-ads-connector`  
**Interner Provider-Key:** `openai_ads`  
**Dashboard:** `/dashboard/chatgpt-ads`

## Implementierter Umfang

Der Branch ergänzt einen produktionsnahen OpenAI-Ads-Connector auf Basis der offiziellen Advertiser API. Kunden können mehrere Werbekonten verbinden, weil jeder OpenAI-Ads-API-Key genau einem Ad Account zugeordnet ist. Der Key wird mit `GET /ad_account` verifiziert, danach per AES-256-GCM verschlüsselt und niemals an den Browser zurückgegeben.

Der Read-Sync lädt Konto, Kampagnen, Anzeigengruppen, Anzeigen und die letzten 30 Tage täglicher Kampagnen-Insights. Die Hierarchie wird erst nach vollständig erfolgreichem Abruf atomar gespeichert. Die Views `cross_platform_account_performance_daily` und `cross_platform_campaign_performance_30d` normalisieren Meta- und OpenAI-Ads-Metriken als Basis für spätere Budgetoptimierung.

Der Write-Flow erstellt Bild, Kampagne, Anzeigengruppe und Chat-Card-Anzeige vollständig im Zustand `paused`. Eine separate, ausdrücklich bestätigte Aktivierung prüft Accountstatus, Brand Review und Ad Review. Sie aktiviert Ad → Ad Group → Campaign; die Kampagne wird zuletzt aktiviert. Bei Fehlern wird die Kette wieder pausiert. Ein nicht bestätigbarer Zustand wird als `activation_uncertain` gekennzeichnet und verlangt sofortige manuelle Kontrolle im Ads Manager.

## Wichtige Dateien

| Bereich | Datei |
|---|---|
| Provider-Client | `src/lib/openai-ads/client.ts` |
| Credential-Verbindung | `src/lib/openai-ads/connection.ts` |
| Read-Sync | `src/lib/openai-ads/sync.ts` |
| PAUSED-Launch/Aktivierung | `src/lib/openai-ads/launch.ts` |
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
5. Einen kleinen Testlaunch mit explizitem Standort und kleinem Lifetime-Budget anlegen. Im Ads Manager bestätigen, dass Campaign, Ad Group und Ad pausiert sind.
6. Anzeigenprüfung abwarten. Erst dann über „Prüfen & aktivieren“ aktivieren und den Remotezustand erneut im Ads Manager kontrollieren.
7. Zweites Konto über einen separaten accountbezogenen API-Key verbinden und Tenant-/Kontentrennung prüfen.
8. Erst nach Staging-Abnahme Migration, Secret und Deployment in Produktion übernehmen.

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

Die automatische kanalübergreifende Budgetumschichtung ist noch nicht freigeschaltet. Eine belastbare Optimierung benötigt mindestens zwei produktive Kanäle mit vergleichbarer Conversion-Definition, Währung, Attributionsfenster, Datenfrische und ausreichender Stichprobe. Der neue Connector liefert die normalisierte Datenbasis; die erste OpenAI-Aktivierung bleibt bewusst human-in-the-loop.

Eine Trennung in Adbot entfernt das verschlüsselte Credential und lässt historische Reportings bestehen. Weil der Provider keinen Remote-Revoke über diesen Flow ausführt, soll der Kunde den Key zusätzlich im OpenAI Ads Manager widerrufen.
