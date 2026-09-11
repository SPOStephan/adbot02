# OpenAI Ads Connector

**Stand:** 11. September 2026
**Ziel:** Erster produktiver Nicht-Meta-Connector für Adbot.one

## Verifizierter Providervertrag

Die OpenAI Advertiser API ist unter `https://api.ads.openai.com/v1` öffentlich dokumentiert. Ein Ads-API-Key wird im OpenAI Ads Manager erzeugt und ist genau einem Werbekonto zugeordnet. Er wird als Bearer-Token übertragen. Dies ist ausdrücklich nicht derselbe Schlüssel wie ein normaler OpenAI-Platform-API-Key.

OpenAI dokumentiert aktuell keinen OAuth-Autorisierungs- oder Token-Endpunkt für API-Partner. Ein Meta-ähnlicher Consent-Redirect ist deshalb nicht möglich. Das Adbot-Onboarding reduziert den offiziell notwendigen Key-Weg auf zwei Schritte: Der Nutzer öffnet `https://ads.openai.com`, wählt das Werbekonto und erzeugt unter **Einstellungen → API Keys** den accountgebundenen Schlüssel; anschließend fügt er ihn einmalig in Adbot ein. Adbot ermittelt mit `GET /ad_account` automatisch Konto-ID, Name, Währung, Zeitzone und Reviewstatus und zeigt unmittelbar eine konkrete Erfolgsbestätigung.

`GET /ad_account` dient zur Verifikation und liefert Werbekonto-ID, Name, URL, Status, Zeitzone, Währung sowie Brand-Reviewstatus. Kampagnen, Anzeigengruppen und Anzeigen können gelesen, erstellt und geändert werden. Alle drei Ebenen unterstützen `active` und `paused`; Anzeigen besitzen zusätzlich `review_status` mit `in_review`, `rejected` oder `approved`. Eine Anzeige kann nur ausgeliefert werden, wenn sie genehmigt ist und Anzeige, Anzeigengruppe und Kampagne aktiv sind.

Listen verwenden Cursor-Pagination mit `after`, `last_id` und `has_more`. Insights stehen auf Account-, Kampagnen-, Ad-Group- und Ad-Ebene bereit. Tägliche Kampagnenauswertung verwendet `GET /ad_account/insights` mit `time_granularity=daily`, `aggregation_level=campaign`, wiederholten `fields[]` und einem JSON-kodierten `time_ranges[]`-Parameter.

Conversionzahlen werden separat über `POST /conversions/insights` auf Kampagnenebene geladen. Da die dokumentierte Antwort kein Datum enthält, fragt Adbot jeden vorhandenen Tagesbucket separat ab und ordnet das Datum lokal aus dem Requestfenster zu. OpenAI weist `conversions` als Click-through-Conversions aus; View-through-Conversions bleiben als ergänzende Provider-Metadaten getrennt. Scheitert auch nur ein erforderlicher Conversionabruf, wird der gesamte atomare Snapshot nicht ersetzt; unvollständige Attribution wird dadurch weder als null gespeichert noch für Optimierungen verwendet.

Geldwerte bei Writes werden in **Micros** übergeben. Kampagnen unterstützen laut aktueller Referenz ein Lifetime-Spend-Limit. Das dokumentierte Daily-Spend-Limit ist dagegen **kontoweit**, revisionsgebunden und betrifft damit alle Kampagnen des Werbekontos. Ohne Standorttargeting kann eine Kampagne alle verfügbaren Orte adressieren.

Die API limitiert pro Endpunkt auf 600 Requests pro Minute und insgesamt auf 1.200 Requests pro Minute, jeweils nach Werbekonto und IP. Der Connector verwendet deshalb begrenzte Parallelität, vollständige Pagination, Account-Claims und Backoff.

## Sicherheits- und Produktvertrag

API-Keys werden ausschließlich serverseitig entgegengenommen, zuerst mit `GET /ad_account` verifiziert und anschließend mit AES-256-GCM verschlüsselt. Sie erscheinen weder in Browserantworten noch in URL, Logs, Audit-Payloads oder Supabase-Browserzugriffen. Jedes Werbekonto erhält eine eigene Verbindung; mehrere OpenAI-Ads-Konten pro Adbot-Nutzer sind zulässig.

Die Verbindungsbestätigung wartet bewusst nicht auf den potenziell längeren vollständigen Kampagnenimport. Nach erfolgreicher Accountprüfung und verschlüsselter Speicherung erhält der Nutzer sofort die Erfolgskarte. Der Browser stößt anschließend den Erstimport an; zugleich wird `provider_next_sync_at` auf den Verbindungszeitpunkt gesetzt, damit der stündliche Cron den Import auch dann sicher nachholt, wenn der Browser geschlossen wird.

Der Read-Sync lädt die komplette Hierarchie Campaign → Ad Group → Ad sowie tägliche Kampagnen-Insights und ersetzt den lokalen Snapshot erst nach vollständigem Erfolg atomar. Historische Daten bleiben beim Disconnect bestehen, während Ciphertext, IV und Authentifizierungstag entfernt werden.

Der Read-Connector ist vom Write-Flow getrennt. **Neue ACTIVE-Launches sind derzeit server- und UI-seitig gesperrt**, weil ein kampagnenbezogenes Tageslimit in der offiziellen API nicht belegt ist. Vor einer Freigabe ist eine ausdrückliche Produktentscheidung zum kontoweiten Limit einschließlich `expected_revision`, Auswirkung auf alle laufenden Kampagnen und Provider-Read-back erforderlich. Der vorhandene Launchcode bleibt vorbereitet, sendet aber kein undokumentiertes Campaign-Tageslimit. Sein Fehlerpfad versucht alle vorhandenen Remoteobjekte unabhängig zu pausieren und markiert einen Launch nur dann als sicher zurückgenommen, wenn der anschließende Read-back für die gesamte Kette `paused` bestätigt.

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
