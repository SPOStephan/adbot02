# OpenAI Ads Connector

**Stand:** 10. September 2026  
**Ziel:** Erster produktiver Nicht-Meta-Connector für Adbot.one

## Verifizierter Providervertrag

Die OpenAI Advertiser API ist unter `https://api.ads.openai.com/v1` öffentlich dokumentiert. Ein Ads-API-Key wird im OpenAI Ads Manager erzeugt und ist genau einem Werbekonto zugeordnet. Er wird als Bearer-Token übertragen. Dies ist ausdrücklich nicht derselbe Schlüssel wie ein normaler OpenAI-Platform-API-Key.

`GET /ad_account` dient zur Verifikation und liefert Werbekonto-ID, Name, URL, Status, Zeitzone, Währung sowie Brand-Reviewstatus. Kampagnen, Anzeigengruppen und Anzeigen können gelesen, erstellt und geändert werden. Alle drei Ebenen unterstützen `active` und `paused`; Anzeigen besitzen zusätzlich `review_status` mit `in_review`, `rejected` oder `approved`. Eine Anzeige kann nur ausgeliefert werden, wenn sie genehmigt ist und Anzeige, Anzeigengruppe und Kampagne aktiv sind.

Listen verwenden Cursor-Pagination mit `after`, `last_id` und `has_more`. Insights stehen auf Account-, Kampagnen-, Ad-Group- und Ad-Ebene bereit. Tägliche Kampagnenauswertung verwendet `GET /ad_account/insights` mit `time_granularity=daily`, `aggregation_level=campaign`, wiederholten `fields[]` und einem JSON-kodierten `time_ranges[]`-Parameter.

Conversionzahlen werden separat über `POST /conversions/insights` auf Kampagnenebene und in täglicher Granularität geladen. OpenAI weist `conversions` als Click-through-Conversions aus; View-through-Conversions bleiben als ergänzende Provider-Metadaten getrennt. Ist dieser Endpoint für ein Konto nicht verfügbar, speichert und zeigt Adbot den Messwert als **nicht verfügbar** statt fälschlich als null Conversions.

Geldwerte bei Writes werden in **Micros** übergeben. Kampagnen unterstützen Lifetime- und Daily-Spend-Limits. Ohne Standorttargeting kann eine Kampagne alle verfügbaren Orte adressieren; Adbot verlangt daher im Launch-Flow mindestens einen explizit gewählten Standort aus `GET /geo_lookup/search`.

Die API limitiert pro Endpunkt auf 600 Requests pro Minute und insgesamt auf 1.200 Requests pro Minute, jeweils nach Werbekonto und IP. Der Connector verwendet deshalb begrenzte Parallelität, vollständige Pagination, Account-Claims und Backoff.

## Sicherheits- und Produktvertrag

API-Keys werden ausschließlich serverseitig entgegengenommen, zuerst mit `GET /ad_account` verifiziert und anschließend mit AES-256-GCM verschlüsselt. Sie erscheinen weder in Browserantworten noch in URL, Logs, Audit-Payloads oder Supabase-Browserzugriffen. Jedes Werbekonto erhält eine eigene Verbindung; mehrere OpenAI-Ads-Konten pro Adbot-Nutzer sind zulässig.

Der Read-Sync lädt die komplette Hierarchie Campaign → Ad Group → Ad sowie tägliche Kampagnen-Insights und ersetzt den lokalen Snapshot erst nach vollständigem Erfolg atomar. Historische Daten bleiben beim Disconnect bestehen, während Ciphertext, IV und Authentifizierungstag entfernt werden.

Im Betriebsmodell A bestätigt der Kunde vor dem Write einmalig Kampagne, Targeting, Tagesbudget, Laufzeitbudget und Maximalgebot. Danach erstellt Adbot Kampagne, Anzeigengruppe und Chat-Card-Anzeige idempotent direkt im Zustand `active`; eine zweite Aktivierungsaktion ist für neue Launches nicht vorgesehen. Läuft die OpenAI-Anzeigenprüfung noch, bleibt die Kette ACTIVE und beginnt nach Genehmigung automatisch mit der Auslieferung. Bei abgelehnter Anzeige oder einem technischen Teilfehler pausiert Adbot alle bereits erzeugten Remoteobjekte als definierten Rückfallzustand. Kann diese Rücknahme nicht vollständig bestätigt werden, wird der Launch als `activation_uncertain` markiert und verlangt sofortige manuelle Prüfung.

## Abgrenzung der kanalübergreifenden Optimierung

Die Migration ergänzt providerneutrale 30-Tage- und Tages-Views für Meta und OpenAI Ads. Damit können Spend, Impressions, Klicks, Conversions, CPC, CTR, Cost per Conversion und ROAS kanalübergreifend verglichen werden. Die Bestätigung eines neuen kostenwirksamen Launches bleibt beim Kunden; dessen Objekte werden anschließend direkt ACTIVE erzeugt. Eine automatische Umschichtung bestehender Budgets wird erst freigeschaltet, wenn mindestens zwei Kanäle echte, vergleichbare Zielmetriken, Währungen, Attributionsfenster und aktuelle Daten liefern.

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
