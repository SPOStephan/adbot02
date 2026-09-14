# OpenAI Ads Connector

**Stand:** 12. September 2026
**Ziel:** Erster produktiver Nicht-Meta-Connector für Adbot.one

## Verifizierter Providervertrag

Die OpenAI Advertiser API ist unter `https://api.ads.openai.com/v1` öffentlich dokumentiert. Ein Ads-API-Key wird im OpenAI Ads Manager erzeugt und ist genau einem Werbekonto zugeordnet. Er wird als Bearer-Token übertragen. Dies ist ausdrücklich nicht derselbe Schlüssel wie ein normaler OpenAI-Platform-API-Key.

Der produktive Adbot-Connector verwendet weiterhin den bereits bewährten accountgebundenen API-Key-Weg und verändert bestehende Verbindungen nicht. Der Nutzer öffnet `https://ads.openai.com`, wählt das Werbekonto und erzeugt unter **Einstellungen → API Keys** den Schlüssel; anschließend fügt er ihn einmalig in Adbot ein. Adbot ermittelt mit `GET /ad_account` automatisch Konto-ID, Name, Währung, Zeitzone und Reviewstatus und zeigt unmittelbar eine konkrete Erfolgsbestätigung.

`GET /ad_account` dient zur Verifikation und liefert Werbekonto-ID, Name, URL, Status, Zeitzone, Währung, Brand-Reviewstatus sowie optional ein separates `account_integrity_review`. Adbot speichert dessen beobachteten Zustand und lässt einen Launch nur zu, wenn ein vorhandenes Integrity Review genehmigt ist. Kampagnen, Anzeigengruppen und Anzeigen können gelesen, erstellt und geändert werden. Alle drei Ebenen unterstützen `active` und `paused`; Anzeigen besitzen zusätzlich `review_status` mit `in_review`, `rejected` oder `approved`. Eine Anzeige kann nur ausgeliefert werden, wenn Konto- und Anzeigenprüfungen genehmigt sind und Anzeige, Anzeigengruppe und Kampagne aktiv sind.

Listen verwenden Cursor-Pagination mit `after`, `last_id` und `has_more`. Insights stehen auf Account-, Kampagnen-, Ad-Group- und Ad-Ebene bereit. Tägliche Kampagnenauswertung verwendet `GET /ad_account/insights` mit `time_granularity=daily`, `aggregation_level=campaign`, wiederholten `fields[]` und einem JSON-kodierten `time_ranges[]`-Parameter.

Der Delivery-Request projiziert ausschließlich die aktuell dokumentierten Felder `metadata.readable_time`, `campaign.id`, `campaign.name`, `campaign.clicks`, `campaign.impressions` und `campaign.spend`. Ein früher verwendetes, inzwischen nicht dokumentiertes `metadata.data_status` wird nicht angefordert; sein lokales Feld bleibt für rückwärtskompatible Snapshots nullable.

Conversionzahlen werden separat über `POST /conversions/insights` auf Kampagnenebene geladen. Da die dokumentierte Antwort kein Datum enthält, fragt Adbot jeden vorhandenen Tagesbucket separat mit `include_zero_rows=true` ab und ordnet das Datum lokal aus dem Requestfenster zu. Für jeden Request müssen Antwort-`count` und `data` übereinstimmen und jede angeforderte Campaign-ID genau einmal vorkommen; fehlende, doppelte oder fremde IDs blockieren den Snapshot. OpenAI weist `conversions` als Click-through-Conversions aus; View-through-Conversions bleiben als ergänzende Provider-Metadaten getrennt. Required Envelopes und Pflichtzahlen werden typ- und integergenau geprüft und nie still zu null oder 0 normalisiert. Scheitert auch nur ein erforderlicher Conversionabruf, wird der gesamte atomare Snapshot nicht ersetzt; unvollständige Attribution wird dadurch weder als null gespeichert noch für Optimierungen verwendet.

Geldwerte bei Writes werden in **Micros** übergeben. Der aktuelle Campaign-Create-Vertrag unterstützt `daily_spend_limit_micros` und `lifetime_spend_limit_micros` auf Kampagnenebene. Adbot verwendet für neue Launches ausschließlich `daily_spend_limit_micros` als kampagnenspezifisches tägliches Ausgabenlimit. Das getrennte kontoweite Spend-Limit wird weder gelesen noch verändert. Adbot ergänzt das dokumentierte Campaign-Limit nicht um unbelegte Tages- oder Mehrtagessemantik. Ohne Standorttargeting kann eine Kampagne alle verfügbaren Orte adressieren, weshalb der Create-Flow mindestens einen expliziten Standort verlangt.

Die API limitiert pro Endpunkt auf 600 Requests pro Minute und insgesamt auf 1.200 Requests pro Minute, jeweils nach Werbekonto und IP. Der Connector verwendet deshalb begrenzte Parallelität, vollständige Pagination, tokenisierte Account-Claims und Backoff. Jeder Connect oder Disconnect rotiert zusätzlich eine Credential-Generation. Alte Worker dürfen Fehler, Credential-Retirement und Snapshotcommit nur ausführen, solange Claim-Token und Generation noch exakt aktuell sind.

## Sicherheits- und Produktvertrag

API-Keys werden ausschließlich serverseitig entgegengenommen, zuerst mit `GET /ad_account` verifiziert und anschließend mit AES-256-GCM verschlüsselt. Sie erscheinen weder in Browserantworten noch in URL, Logs, Audit-Payloads oder Supabase-Browserzugriffen. Jedes Werbekonto erhält eine eigene Verbindung; mehrere OpenAI-Ads-Konten pro Adbot-Nutzer sind zulässig.

Die Verbindungsbestätigung wartet bewusst nicht auf den potenziell längeren vollständigen Kampagnenimport. Nach erfolgreicher Accountprüfung und verschlüsselter Speicherung erhält der Nutzer sofort die Erfolgskarte. Der Browser stößt anschließend den Erstimport an; zugleich wird `provider_next_sync_at` auf den Verbindungszeitpunkt gesetzt, damit der stündliche Cron den Import auch dann sicher nachholt, wenn der Browser geschlossen wird.

Das Onboarding verwendet die blaue Adbot-Primärfarbe für Informationsflächen, Schritte, Fokuszustände und Hauptaktionen. Grün ist ausschließlich erfolgreichen Statusmeldungen vorbehalten. Eine optionale Bildanleitung öffnet sich in einem neuen Tab, sobald ein Site-Admin sie veröffentlicht hat. Site-Admins verwalten bis zu zwölf geordnete Schritte unter `/dashboard/chatgpt-ads-anleitung`: Titel, Erklärung und Screenshot können ohne Deployment ergänzt, ersetzt, sortiert, ausgeblendet oder entfernt werden. Erlaubt sind PNG, JPEG und WebP bis 8 MB; veröffentlichte Bilder dürfen keine API-Keys, Passwörter oder personenbezogenen Daten enthalten.

Der Read-Sync lädt die komplette Hierarchie Campaign → Ad Group → Ad sowie tägliche Kampagnen-Insights und ersetzt den lokalen Snapshot erst nach vollständigem Erfolg atomar. Der Reportingzeitraum umfasst exakt die letzten 30 **vollständig abgeschlossenen** Kalendertage in der Zeitzone des Werbekontos; der laufende lokale Tag und abgeschnittene Randtage werden nicht gespeichert. Delivery fragt `includes[]=zero_impression_items` an. Conversionrequests entstehen für jedes dieser account-lokalen Tagesfenster unabhängig davon, ob bereits eine Deliveryzeile zurückkam. Delivery und Conversions müssen danach jede Campaign-/Tageskombination vollständig und eindeutig abdecken; andernfalls wird kein Snapshot geschrieben. Historische Daten bleiben beim Disconnect bestehen, während Ciphertext, IV und Authentifizierungstag entfernt werden.

Der Read-Connector bleibt vom Write-Flow getrennt. Neue Launches verwenden den versionierten Vertrag `paused_campaign_daily_v1`: Adbot prüft zunächst das Werbekonto, erstellt Campaign, Ad Group und Ad idempotent mit `paused`, verlangt nach jeder Create-Antwort einen unmittelbaren PAUSED-GET und liest danach den vollständigen Vertrag zurück. Die getrennte read-only Aktivierungsvorschau ruft OpenAIs offizielles `POST /ads/{ad_id}/preview` auf und rendert `data[].body` in sandboxed Iframes. Der fünf Minuten gültige HMAC-Beleg bindet Vertrag und Providerpreview-Hash. Unmittelbar vor und nach ACTIVE wird erneut gelesen; Preview-Hashdrift führt ohne Write zurück zur Vorschau, andere Abweichungen lösen Safety-Pause aus. Zusätzlich validiert eine eigene Control Plane nach jeder vollständig paginierten Hierarchie und vor Insights/Conversions alle lokalen PAUSED- und ACTIVE-Launches. Nur vollständige Vertragsparität darf READY beziehungsweise ACTIVE erhalten; Reportingfehler, Legacy-/Missing-ID-, Budget-, Parentage-, Targeting-, Product-, Landing-, Serving- oder Creative-Drift können das unmittelbare Containment nicht überspringen. Der vollständige Vertrag ist in [`SAFE_PAUSED_DAILY_LAUNCH.md`](./SAFE_PAUSED_DAILY_LAUNCH.md) dokumentiert.

## Abgrenzung der kanalübergreifenden Optimierung

Die Migration ergänzt providerneutrale 30-Tage- und Tages-Views für Meta und OpenAI Ads. Damit können Spend, Impressions, Klicks, Conversions, CPC, CTR, Cost per Conversion und ROAS kanalübergreifend verglichen werden. Eine automatische Umschichtung oder ein neuer kostenwirksamer OpenAI-Launch wird erst freigeschaltet, wenn die Providerlimits technisch verifiziert sind und mindestens zwei Kanäle echte, vergleichbare Zielmetriken, Währungen, Attributionsfenster und aktuelle Daten liefern.

## Offizielle Quellen

1. [Advertiser API Overview](https://developers.openai.com/ads/api-overview)
2. [Authentication](https://developers.openai.com/ads/api-reference/authentication)
3. [Ad Account](https://developers.openai.com/ads/api-reference/ad-account)
4. [Campaigns](https://developers.openai.com/ads/api-reference/campaigns)
5. [Ad Groups](https://developers.openai.com/ads/api-reference/ad-groups)
6. [Ads](https://developers.openai.com/ads/api-reference/ads)
7. [Insights](https://developers.openai.com/ads/api-reference/insights)
8. [Campaign Targeting](https://developers.openai.com/ads/campaign-targeting)
9. [OpenAPI specification](https://developers.openai.com/ads/openapi.json)
10. [OpenAI Ads Policies](https://openai.com/policies/ad-policies/)
11. [Ads Manager Beta Overview](https://help.openai.com/en/articles/20001206-ads-manager-beta-overview)
12. [Ads Manager Beta Account Setup](https://help.openai.com/en/articles/20001213-ads-manager-beta-account-setup)
