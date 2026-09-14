# Cursor Handoff: ChatGPT Ads

**Branch:** `feature/openai-ads-paused-daily-launch`
**Interner Provider-Key:** `openai_ads`
**Dashboard:** `/dashboard/chatgpt-ads`

## Sicherer aktueller Umfang

Der Connector unterstützt mehrere OpenAI-Ads-Werbekonten pro Adbot-Nutzer. Der vorhandene accountbezogene API-Key-Weg bleibt unverändert: Ein Key wird über `GET /ad_account` verifiziert, mit AES-256-GCM verschlüsselt gespeichert und nie an den Browser zurückgegeben. Der Read-Sync lädt Account, Campaigns, Ad Groups, Ads, Delivery-Insights und Conversion-Insights. Die lokale Hierarchie wird erst nach einem vollständigen Providerabruf atomar ersetzt.

Conversion-Antworten enthalten laut offizieller Referenz kein Datum. Der Sync normalisiert den Zeitraum deshalb zuerst auf die letzten 30 vollständig abgeschlossenen Mitternacht-zu-Mitternacht-Kalendertage in der Account-Zeitzone. Er erzeugt daraus Tagesfenster unabhängig von vorhandenen Deliveryzeilen und führt je Fenster einen Conversion-Request mit `include_zero_rows=true` aus. Delivery fordert zugleich `includes[]=zero_impression_items` an. Jede Campaign-/Tageskombination muss in beiden Datenmengen vollständig und eindeutig enthalten sein; fehlende, doppelte oder fremde Zeilen blockieren. Abgeschnittene Randtage werden abgelehnt. Delivery- und Conversion-Pflichtmetriken werden weder im Client noch in SQL zu 0 normalisiert. Scheitert ein erforderlicher Request, wird kein Teilsnapshot geschrieben. Die providerneutralen Views `cross_platform_account_performance_daily` und `cross_platform_campaign_performance_30d` bilden weiterhin die Grundlage für spätere kanalübergreifende Optimierung.

Neue Launches verwenden ausschließlich `paused_campaign_daily_v1`. Das Formular erfasst `daily_spend_limit_micros` als kampagnenspezifisches tägliches Ausgabenlimit. Die Create-Route lädt das Bild und erstellt Campaign, Ad Group und Ad nur mit `paused`; sie schreibt kein kontoweites Spend-Limit. Nach jeder Create-Antwort verlangt sie `paused` und führt vor der nächsten Ebene einen unmittelbaren GET aus. Der vollständige Read-back prüft Accountbindung, Währung, Zeitzone, Brand Review, ein gegebenenfalls vorhandenes separates Account-Integrity-Review, Daily Limit, fehlendes Lifetime Limit, Bid, Zeitfenster, Targeting, Parentage, Campaign-Produktfeed, Ad-Group-Produktset, Landingparameter auf allen Ebenen, Creative, Ad-Review, Status und ausdrücklich angeforderte Serving Issues. PAUSED erlaubt nur die dokumentierten statusbedingten Inaktivitätscodes und zum tatsächlichen Reviewstatus passende Reviewcodes; ACTIVE verlangt leere Listen. Insights, Conversions und ihre Pflicht-Envelopes werden ohne Null-Defaults fail-closed geparst.

Die Aktivierung beginnt mit einer read-only Previewroute. Sie wiederholt den vollständigen PAUSED-Read und ruft OpenAIs offizielles `POST /ads/{ad_id}/preview` auf. Die UI zeigt die Providerbodies in sandboxed Iframes sowie alle materiellen Launchparameter einschließlich Kampagnenbeschreibung und Context Hints. Ein fünf Minuten gültiger HMAC-Beleg bindet Nutzer, Launch, Remotehierarchie, Daily Limit, vollständigen Contract-Hash und Providerpreview-Hash. Erst **„Kostenwirksam ACTIVE schalten“** startet die Aktivierungsroute. Diese prüft Contract und Providerpreview erneut, aktiviert Ad und Ad Group vor der Campaign und verlangt anschließend einen vollständigen ACTIVE-Read.

## Fail-closed Saga und Recovery

Create besitzt in der 180-Sekunden-Route ein Providerzeitbudget von 120 Sekunden; mindestens 60 Sekunden bleiben für Safety und Abschluss. Jede gerade zurückgegebene Provider-ID wird vor ihrem DB-Einzelwrite im lokalen Saga-Zustand gehalten. Scheitert dieser Write, kennt der Safety-Client das Remoteobjekt trotzdem und der Finish-CAS persistiert die ID zusammen mit dem Fehlerstatus. Eine leere oder unvollständige ID-Kette gilt nie als sicher pausiert.

Providerpreview-Hash-Drift führt ohne Provider-Write zurück zu `ready_to_activate`. Jede andere Pre-ACTIVE-Abweichung nach Aufbau des Providerclients löst sofort Safety-Pause aus. Nach begonnenem ACTIVE gilt dasselbe für Providerfehler, verlorene Antworten und fehlerhafte Post-Reads. Nur ein separater Read-back, der alle bekannten Objekte als `paused` bestätigt, erlaubt den Status `failed`; andernfalls bleibt `activation_uncertain` mit manueller Warnung. Auch stabile Create-Replays aus PAUSED, IN_REVIEW, READY, BLOCKED oder ACTIVE werden atomar geclaimt und frisch gelesen; insbesondere kann ein BLOCKED-Replay keine zwischenzeitliche ACTIVE-Drift am unmittelbaren Containment vorbeiführen. Ein Replay eines bereits erfolgreichen Launches antwortet auch nach Tokenablauf nur nach frischem vollständigem ACTIVE-Read idempotent.

Eine dedizierte Control Plane läuft unmittelbar nach dem vollständig paginierten Hierarchieread und vor Delivery-/Conversionreporting. Sie validiert PAUSED- und ACTIVE-Launches gegen den vollständigen Runtimevertrag; Insightsfehler können Safety-Containment daher nicht verhindern. Der Snapshot wiederholt die materiellen Vertragsprüfungen SQL-seitig und CAS-t Status plus Operation-Token, damit kein paralleler Claim oder Finish überschrieben wird. Account-Syncs sind zusätzlich durch eine bei Connect/Disconnect rotierende Credential-Generation und einen zufälligen Claim-Token gefencet; alte Worker können weder neue Credentials widerrufen noch einen neueren Snapshot committen. Nur eine exakte PAUSED-v1-Kette darf `ready_to_activate` werden und nur eine exakte ACTIVE-v1-Kette mit genehmigtem Ad-Review lokal `active` bleiben. Providerstatus-, Legacy-, Budget-, Scope-, Parentage-, Product-, Landing-, Serving- oder Creative-Drift wird `activation_uncertain` und sofort per Safety-Client pausiert. PAUSED gilt erst nach ID-genauem Read-back aller drei Hierarchieebenen als bestätigt. Die Migration quarantänisiert ausschließlich bereits lokale ACTIVE-Legacyzeilen ohne vollständigen v1-Vertrag; valide ACTIVE-v1-Zeilen bleiben erhalten und werden beim nächsten Hierarchieread geprüft. Der Fünf-Minuten-Cron übernimmt zusätzlich stale Sagas.

## Integrität und Kompatibilität

Die gemeinsame Dashboard- und Connectorstatus-Abfrage liest weiterhin ausschließlich stabile, migrationsunabhängige Plattformkonto-Spalten. OpenAI-spezifische Felder werden getrennt und nur bei tatsächlich vorhandenem OpenAI-Konto geladen. Fehlt Live-Konfiguration oder Zielschema, rendert die ChatGPT-Ads-Seite einen kontrollierten Nicht-verfügbar-Zustand. Die neue Migration ändert keine Meta-Tabelle, kein Meta-Credential und keine bestehende OpenAI-Verbindung.

Bereits veröffentlichte Migrationen werden nicht rückwirkend verändert. `20260912170000_openai_ads_paused_daily_launch_safety.sql` ist additiv und enthält die explizite aktuelle Definition von `replace_openai_ads_snapshot`; sie verwendet keinen fragilen Runtime-Textpatch.

## Wichtige Dateien

| Bereich | Datei |
| --- | --- |
| Providerclient, required Responsefelder, Preview und Deadline | `src/lib/openai-ads/client.ts` |
| Credential-Verbindung | `src/lib/openai-ads/connection.ts` |
| Read-/Conversion-Sync und unmittelbares Snapshotcontainment | `src/lib/openai-ads/sync.ts` |
| Pausierter Zwei-Phasen-Launch, HMAC, Read-back und Recovery | `src/lib/openai-ads/launch.ts` und `src/lib/openai-ads/launch-safety.ts` |
| Sichtbare Providerpreview und Kostenbestätigung | `src/components/OpenAIAdsWorkspace.tsx` |
| Launchformular | `src/components/OpenAIAdsLaunchForm.tsx` |
| Sicherheitsmigration | `supabase/migrations/20260912170000_openai_ads_paused_daily_launch_safety.sql` |
| Pure Contracttests | `scripts/test-openai-ads-launch-safety.mjs` |
| Provider-HTTP-/Paginationtests | `scripts/test-openai-ads-launch-readback-client.mjs` |
| Verhaltensbasierter Saga-Harness | `scripts/test-openai-ads-launch-saga.mjs` |
| Fresh-DB-/RLS-Test | `scripts/test-openai-ads-database.mjs` und `scripts/test-openai-ads-connector.sql` |
| Vollständiger Vertrag und Quellen | `docs/openai-ads/SAFE_PAUSED_DAILY_LAUNCH.md` und `docs/openai-ads/OPENAI_ADS_CONNECTOR.md` |

## Direkter Live-Rollout ohne Staging

Adbot besitzt nur das Live-System. Trotzdem bleibt die Reihenfolge strikt:

1. Vollständige lokale Testmatrix und zwei unabhängige Reviews abschließen.
2. PR gegen `main` eröffnen, aber noch nicht mergen.
3. Der Nutzer führt `20260912170000_openai_ads_paused_daily_launch_safety.sql` einmalig im SQL Editor des tatsächlich von Adbot genutzten Live-Supabase-Projekts aus.
4. Anschließend ausschließlich read-only prüfen, dass Spalten, Trigger, Index, Funktionsdefinition und ACLs vorhanden sind und Browserrollen Claim/CAS nicht ausführen können.
5. Erst nach Nutzerbestätigung PR mergen und direkt produktiv deployen.
6. Produktionsseiten und bestehende Meta-/OpenAI-Verbindungen read-only prüfen. Ein PAUSED-Create erzeugt Providerobjekte und wird nur auf ausdrücklichen Wunsch live getestet. Eine ACTIVE-Aktion erfordert immer die konkrete sichtbare Kostenbestätigung.

Keine bestehende Verbindung wird getrennt, rotiert, resettet oder neu verbunden. Die Migration wird nicht automatisch von diesem PR angewendet.

## Verifikation

```bash
npm run test:openai-ads
npm run test:meta-all
npm run lint
npx tsc --noEmit
npm run build
git diff --check
```

Der DB-Test startet einen temporären PostgreSQL-Cluster, wendet sämtliche Migrationen sortiert an und erstellt zusätzlich eine zweite Upgrade-Datenbank auf dem Stand unmittelbar vor der neuen Safety-Migration. Dort werden Legacy-ACTIVE und valides ACTIVE-v1 angelegt; die Migration läuft zweimal idempotent. Fresh-DB-Fälle prüfen vollständige PAUSED-/ACTIVE-Parität sowie eine Driftmatrix für Namen, Beschreibung, Zeit, Targeting, Produkt-/Landingfelder, Bid, Multiplikatoren, Creative, File-ID und Serving Issues. Der Saga-Harness simuliert außerdem unerwartet ACTIVE Create-Antworten auf jeder Ebene, DB-Persistenzfehler, unbekannte Providerausgänge, Previewhash-Drift, Pre-/Postwritefehler, ACTIVE-Replaydrift, periodische ACTIVE-Reconciliation, Parallelclaim, Missing-ID-Race und stale Recovery.

## Bewusste Grenzen

Die automatische kanalübergreifende Budgetumschichtung bleibt gesperrt, bis mindestens zwei produktive Kanäle vergleichbare Conversiondefinitionen, Währungen, Attributionsfenster, aktuelle Daten und ausreichende Evidenz liefern. Eine Trennung in Adbot entfernt das verschlüsselte Credential und bewahrt historische Reportings; der Kunde soll den API-Key zusätzlich im OpenAI Ads Manager widerrufen.
