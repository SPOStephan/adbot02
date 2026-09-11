# Quellenstrategie für reale Werbebeispiele

**Stand:** 11. September 2026
**Autor:** Manus AI

## Ergebnis

Adbot sollte die Bibliothek zunächst **kuratiert und quellenbewusst** befüllen. Der Site-Admin lädt einen Screenshot hoch und klassifiziert ihn nach Plattform, Branche, Ziel, Funnel-Stufe, Markt, Format, Quelle, Rechtebasis und Evidenzniveau. Links sind hilfreich und bei offiziellen Anzeigenbibliotheken oder Werbetreibendenseiten verpflichtend. Ein Link allein ersetzt den Screenshot nicht, weil Adbot keine fremden Plattformoberflächen automatisiert scrapen soll.

OpenAI bietet derzeit **keine öffentliche, durchsuchbare Bibliothek fremder ChatGPT-Anzeigen**. Die dokumentierte Advertiser API ist an ein einzelnes autorisiertes Werbekonto gebunden. Sie dient dem Erstellen, Verwalten und Auswerten eigener Anzeigen.[1] [2] Fremde ChatGPT-Anzeigen können deshalb nur über rechtmäßig bereitgestellte Links oder Screenshots in die Bibliothek gelangen.

> **Evidenzregel:** Eine sichtbare Anzeige belegt nur, dass das Creative existiert oder ausgeliefert wurde. Sie belegt nicht, dass die Anzeige wirtschaftlich erfolgreich war.

## Quellenvergleich

| Plattform | Öffentliche Bibliothek | Automatischer Fremdanzeigenzugriff | Empfohlener Adbot-Weg |
| --- | --- | --- | --- |
| OpenAI / ChatGPT Ads | **Nein.** Es ist keine öffentliche Fremdanzeigenbibliothek dokumentiert. | Die Advertiser API liefert Ressourcen des autorisierten eigenen Werbekontos.[1] [2] | Eigene Anzeigen später über die bestehende Kontoverbindung importieren. Fremde Beispiele nur über rechtmäßig bereitgestellte Links und Screenshots erfassen. |
| Meta | **Ja:** Meta Ad Library.[5] | Eine offizielle read-only Ads-Archive-Schnittstelle existiert. Ihr Umfang ist nach Anzeigenart, Region, Feldern und Zugangsberechtigung begrenzt.[6] [7] | Zunächst offizielle Library-Links und Screenshots kuratieren. Später kann eine autorisierte API-Suche für den dokumentierten Umfang ergänzt werden. |
| Google | **Ja:** Google Ads Transparency Center.[8] | Google beschreibt eingeschränkten API-Zugang für Transparenzdaten im Europäischen Wirtschaftsraum. Eine frei nutzbare Universal-API für alle fremden kommerziellen Anzeigen ist nicht belegt.[9] [10] | Manuelle Recherche nach Werbetreibendem oder Website. Quelllink und Screenshot speichern. Einen API-Import erst nach konkreter Zugangs- und Rechteklärung ergänzen. |
| TikTok | **Ja:** Commercial Content Library. Zusätzlich existiert Creative Center / Top Ads.[11] [12] | Die Commercial Content API setzt einen genehmigten Research-Zugang voraus und ist zweckgebunden.[13] [14] | Links und Screenshots kuratieren. Einen API-Import nur mit genehmigtem Zugang und innerhalb des dokumentierten Zwecks umsetzen. |

## In Adbot umgesetzter Datenvertrag

Jedes Beispiel erhält eine strukturierte Zieldefinition. Das Feld beschreibt, **welche Handlung oder Wirkung die Anzeige bei welcher Zielgruppe erreichen soll**. Das allgemeine Werbeziel bleibt separat filterbar. Dadurch kann Adbot später zuerst nach einem groben Ziel wie „Buchungen“ filtern und danach Beispiele mit einer passenden konkreten Absicht auswählen.

| Feldgruppe | Zweck |
| --- | --- |
| Identität | Interner Titel, Werbetreibender, Plattform und Originaldatei machen das Beispiel eindeutig auffindbar. |
| Einordnung | Branche, Werbeziel, konkrete Zieldefinition und Funnel-Stufe bilden die strategische Situation ab. |
| Creative | Format, Hook, Anzeigentext, Handlungsaufforderung und Landingpage beschreiben die ausführbare Anzeigenidee. |
| Markt | Land und Sprache verhindern ungeeignete Referenzen aus anderen Märkten. |
| Herkunft | Quellentyp und Quelllink machen die Herkunft nachvollziehbar. |
| Evidenz | `visual_only`, `public_transparency` und `first_party_performance` trennen Sichtbarkeit von belegter Leistung. |
| Rechte | Eigene Rechte, ausdrückliche Erlaubnis oder reine interne Referenz werden dokumentiert und bestätigt. |
| Qualität | Tags, Qualitätsbewertung und eine fachliche Begründung unterstützen spätere Auswahl und Ranking. |
| KI-Freigabe | Nur explizit freigegebene Beispiele dürfen als Stilreferenz in Creative-Vorschläge einfließen. |

## Beschaffungsplan

### Option 1: Kuratierte Erfassung

Ein Site-Admin recherchiert in den offiziellen Bibliotheken und speichert ausgewählte Beispiele mit Screenshot und Quelllink. Diese Variante ist sofort nutzbar. Sie ermöglicht eine hohe inhaltliche Qualität und eine saubere Rechteprüfung. Der Aufwand wächst jedoch linear mit der Anzahl der Beispiele.

### Option 2: Offizielle, plattformspezifische Imports

Adbot importiert eigene Anzeigen aus verbundenen Werbekonten und ergänzt später autorisierte Transparenzschnittstellen. Diese Variante skaliert besser. Sie erfordert pro Plattform einen eigenen Datenvertrag, Zugang und eine Prüfung des zulässigen Nutzungszwecks. Scraping der öffentlichen Oberflächen ist kein Ersatz für eine offizielle Schnittstelle.

### Empfehlung: Hybrider Aufbau

Adbot beginnt mit einer gezielten kuratierten Grundmenge. Parallel werden **eigene Anzeigen und ihre aggregierten Leistungsdaten** aus verbundenen Konten zur belastbarsten Quelle ausgebaut. Offizielle Fremdanzeigen-APIs werden nur ergänzt, wenn Zugang, Zweck und Nutzungsbedingungen für Adbots kommerzielle Nutzung eindeutig passen.

Für die erste Grundmenge ist ein ausgewogener Korpus sinnvoll. Pro Kombination aus Branche und Ziel sollten mehrere unterschiedliche Creative-Ansätze enthalten sein. Für Hotels und Reisen wären dies beispielsweise Direktbuchung, Angebotskommunikation, Neukundengewinnung, Retargeting und Markenaufbau. Erst danach sollten weitere Branchen in gleicher Struktur ergänzt werden.

## Nutzung für KI-Vorschläge

Die administrative Bibliothek dient als **Retrieval- und Referenzschicht**. Vor einer Creative-Generierung wählt Adbot höchstens wenige passende, ausdrücklich freigegebene Beispiele anhand von Branche, Ziel, Funnel-Stufe, Plattform, Format, Sprache und Markt aus. Die Generierung darf abstrahierte Muster wie Hook-Typ, Angebotsstruktur, visuelle Hierarchie, Vertrauenselemente und Handlungsaufforderung verwenden. Fremde Texte oder Gestaltungen werden nicht unverändert reproduziert.

Davon getrennt existiert ein rechtebereinigter synthetischer Seed-Korpus für das tatsächliche Fine-Tuning des plattformübergreifenden Adbot-Kreativkerns. Bibliotheks-Screenshots gelangen nicht automatisch in diesen Trainingskorpus. Die Trainingsarchitektur und ihre Freigabegates sind in `docs/ad-intelligence/CROSS_PLATFORM_TRAINING.md` dokumentiert.

Leistungssignale werden unterschiedlich gewichtet. Ein rein visuelles Beispiel liefert kein Performance-Signal. Öffentliche Transparenzdaten können Reichweite oder Auslieferung belegen. Nur Daten aus einem eigenen autorisierten Werbekonto dürfen als verifizierte First-Party-Performance gewertet werden.

## References

[1]: https://developers.openai.com/ads/api-overview "OpenAI Ads API Overview"
[2]: https://developers.openai.com/ads/api-reference/ads "OpenAI Ads API – Ads Reference"
[3]: https://openai.com/policies/advertising-terms/ "OpenAI Advertising Terms"
[4]: https://openai.com/policies/ad-tools-terms/ "OpenAI Ad Tools Terms"
[5]: https://www.facebook.com/ads/library/ "Meta Ad Library"
[6]: https://transparency.meta.com/researchtools/ad-library-tools/ "Meta Ad Library Tools"
[7]: https://developers.facebook.com/docs/graph-api/reference/ads_archive/ "Meta Graph API – Ads Archive"
[8]: https://adstransparency.google.com/ "Google Ads Transparency Center"
[9]: https://support.google.com/My-Ad-Center-Help/answer/12155361?hl=de "Google Ads Transparency Center Help"
[10]: https://adstransparency.google.com/terms "Google Ads Transparency Center Additional Terms"
[11]: https://library.tiktok.com/ "TikTok Commercial Content Library"
[12]: https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en "TikTok Creative Center – Top Ads"
[13]: https://developers.tiktok.com/products/commercial-content-api "TikTok Commercial Content API"
[14]: https://developers.tiktok.com/doc/commercial-content-api-getting-started "TikTok Commercial Content API – Getting Started"
