# Plattformübergreifende Strategie- und Budgetplanung

**Stand:** 11. September 2026

## Zielbild

Adbot soll nicht nur Kampagnenoberflächen vereinheitlichen, sondern aus einem Geschäftsziel und einem bestätigten Gesamtbudget einen kanalübergreifenden Maßnahmenplan ableiten. Der neue Vertrag ist deshalb **providerneutral** und auf bis zu zehn Plattformen ausgelegt. Die erste Oberfläche berücksichtigt Meta Ads, Google Ads und ChatGPT Ads standardmäßig; Pinterest, Microsoft Advertising, LinkedIn Ads, TikTok Ads, X Ads, Reddit Ads und Snapchat Ads sind bereits im selben Katalog vorbereitet.

> Der Strategieplaner ist in dieser Ausbaustufe **read-only**. Er erzeugt weder Provider-Writes noch ausführbare Mutationspläne. Bestehende Verbindungen, Kampagnen und Budgets werden nicht verändert.

## Gewählte Architektur

| Ansatz | Vorteil | Risiko | Entscheidung |
|---|---|---|---|
| Ein Sprachmodell entscheidet direkt über Budgets | flexibel | nicht deterministisch, schwer auditierbar, anfällig für erfundene Kennzahlen | nicht verwendet |
| Rein regelbasierter Planer | transparent, testbar, reproduzierbar | benötigt vergleichbare reale Messdaten | als Ausführungskern gewählt |
| Hybrider Ansatz | Modell kann Strategiehypothesen liefern, Code erzwingt Budget- und Sicherheitsregeln | zwei getrennte Verträge erforderlich | vorbereitet: Intelligence liefert Ideen, deterministischer Code entscheidet über Geld |

Die Budgetentscheidung wird durch `src/lib/cross-platform-strategy/planner.ts` getroffen. Der bestehende Adbot-Intelligence-Kern darf später Zielgruppen-, Creative- oder Testhypothesen liefern, erhält aber **keine alleinige Autorität über Geldbewegungen**.

## Planungsalgorithmus

1. Der Nutzer bestätigt Geschäftsziel, Währung, Gesamt-Tagesbudget und bis zu zehn Plattformen.
2. Adbot liest ausschließlich mandanteneigene rohe Performance-Tageszeilen aktiver Konten. Derzeit ist nur Meta für Performancegewichtung freigegeben, mit der kanonischen Körnung Anzeige/Tag. ChatGPT Ads bleibt trotz vorhandenen Read-Adapters ohne Messfreigabe, bis sein Sync fehlende Basismetriken unverändert als `NULL` erhält.
3. Eine Plattform ist nur allokationsfähig, wenn genau ein nutzbares Werbekonto verbunden ist, das Ziel freigegeben ist und vorhandene Performance-Daten zur Planwährung passen.
4. Der Planer benötigt mindestens **zwei ausgewählte und verbundene Plattformen**, die für dasselbe Ziel aktuelle, vollständige und zielspezifische Performance-Signale liefern. Die Messgröße muss auf allen verglichenen Plattformen gleich sein.
5. Fehlt diese Vergleichsbasis, lautet der Status `insufficient_evidence`. Adbot weist dann **0,00 Budget** zu. Weder Plattformreputation noch nicht gemessene Annahmen erzeugen eine Budgetempfehlung.
6. Erst bei ausreichender Vergleichsbasis bewertet der Planer je nach Ziel Impressionen, Klicks, bestätigte Leads, Käufe oder Conversion-Wert relativ zum Spend. Die Budgetgewichte entstehen ausschließlich aus diesen gemessenen Effizienzen.
7. Nicht gemessene oder nicht vergleichbare Kanäle erhalten 0,00 Budget. Zwischen mindestens zwei vergleichbaren Kanälen behält jeder mindestens fünf Prozent; kein Kanal erhält mehr als 60 Prozent.
8. Minor Units werden deterministisch und centgenau verteilt. Bei einem zulässigen Vergleich entspricht die Summe exakt dem bestätigten Gesamtbudget; ohne Vergleich beträgt sie exakt null.
9. Das Ergebnis ist eine Plattform-Zielallokation. Es behauptet noch keinen zulässigen Write-Schritt für einzelne Kampagnen oder Anzeigengruppen.

> **Konsequenz für den aktuellen Live-Stand:** Da derzeit ausschließlich Meta einen freigegebenen Performancevertrag besitzt, kann Adbot aktuell noch keinen echten kanalübergreifenden Gewinner bestimmen. Die Oberfläche muss daher 0,00 Budget allokieren. Erst ein zweiter vollständiger Messadapter – voraussichtlich Google Ads – ermöglicht eine datenbasierte Verteilung. Aktivität auf nur einem Kanal beweist lediglich dessen eigene Effizienz, aber keine Überlegenheit gegenüber einem anderen Kanal.

V1 akzeptiert ausschließlich explizit gelistete ISO-Währungen mit zwei Dezimalstellen. Währungen mit anderen Minor-Unit-Exponenten werden abgewiesen, bis eine einheitliche ISO-4217-Exponententabelle für Eingabe, Datenimport, Allokation und Anzeige vorliegt.

Die Datenabfrage verwendet bewusst nicht die ältere aggregierte View `cross_platform_account_performance_daily`: Eine Voraggregation mit `MIN(currency)` könnte verschiedene Währungen unter einem Label summieren, und SQL-`SUM` würde partielle `NULL`-Attribution ausblenden. Stattdessen werden die letzten 30 Tage direkt aus `performance_data`, ausschließlich für das eine eindeutig verbundene Meta-Konto, in **einem** count-verifizierten Datenbankstatement gelesen. Ein clientseitig paginierter Mehrfachread wäre während eines parallel laufenden Snapshot-Syncs nicht konsistent genug. Der Normalisierer erhält jede Zeilenwährung, jedes `NULL`, `date_stop`, `attribution_setting` und `updated_at`. Jede Tageszeile muss `date_stop = date` erfüllen und eine Attributionseinstellung sowie einen Update-Zeitpunkt besitzen. Da PostgreSQL `now()` innerhalb der atomaren Snapshot-Transaktion stabil ist, dient `updated_at` als lesbarer Snapshot-Marker; die interne Sync-ID bleibt weiterhin nicht an Browser-/Session-Clients freigegeben. Innerhalb eines Kontofensters müssen Attribution und Snapshot-Marker eindeutig sein. Unterschiedliche oder unbekannte Attributionsfenster zwischen Plattformen werden nicht verglichen. Weicht der exakte Count von der gelieferten Zeilenzahl ab, fehlt der Count, überschreitet das Fenster 1.000 Rohzeilen oder tritt ein Read-Fehler auf, wird der gesamte Performance-Read verworfen. Mehrere oder unbekannte Währungen blockieren den Kanal; fehlt für den gewählten Effizienztyp nur ein Teil der erforderlichen Kennzahlen, wird dieser Kanal nicht performancegewichtet. Wenn danach weniger als zwei Plattformen vergleichbar bleiben, entsteht keine Budgetallokation.

## Sicherheits- und Ausführungsvertrag

Eine spätere automatische Ausführung darf nur über einen separaten Execution-Adapter erfolgen. Erst dieser Adapter darf aus dem Plattformziel konkrete Budgetobjekte ableiten und muss mindestens folgende Invarianten durchsetzen:

- maximal 20 Prozent Budgetänderung pro Objekt innerhalb von 24 Stunden;
- mindestens zwölf Stunden Cooldown zwischen automatischen Änderungen desselben Objekts;
- frischer Provider-Read unmittelbar vor einem Write;
- Read-back und Zustandsvergleich nach jedem Write;
- Idempotency-Key und dauerhafte Auditspur;
- kein Wechsel der Währung oder Überschreiten von Konto-, Kampagnen- oder Gesamtlimits;
- kein Write bei mehrdeutiger Kontozuordnung, fehlender Attribution, veralteten Daten oder Providerfehlern;
- automatischer Stopp statt Schätzung, wenn die Messbasis nicht vergleichbar ist.

Diese Grenzen sind bereits Teil des zurückgegebenen Planvertrags. `providerWritesCreated` ist fest `false`.

## Plattformprofile und offizielle Zielgrundlage

Die Plattformprofile begrenzen ausschließlich, welche Ziele fachlich unterstützt werden. Der Katalog enthält keine numerischen Erfolgsannahmen und beeinflusst weder Score noch Budgetallokation.

| Plattform | Normalisierte Ziele | Strategischer Schwerpunkt | Integrationsstand |
|---|---|---|---|
| Meta Ads | Bekanntheit, Traffic, Interaktion, Leads, App, Sales | soziale Discovery und Conversion | Datenadapter live |
| Google Ads | Bekanntheit, Traffic, Interaktion, Leads, App, Sales | Search Intent, Performance Max, YouTube/Demand Gen | nächster Connector |
| ChatGPT Ads | Bekanntheit, Traffic, Interaktion, Leads/Sales | kontextuelle Nachfrage in Gesprächen | Read-Adapter live; noch keine Messfreigabe |
| TikTok Ads | alle sechs Kernziele | Video-Discovery, Engagement, App | vorbereitet |
| Pinterest Ads | Bekanntheit, Traffic, Leads, Sales | visuelle Planung und Kaufkontext | vorbereitet |
| Microsoft Advertising | alle sechs Kernziele | Search Intent und Audience Network | vorbereitet |
| LinkedIn Ads | Bekanntheit, Traffic, Interaktion, Leads, Sales | B2B- und beruflicher Intent | vorbereitet |
| X Ads | Bekanntheit, Traffic, Interaktion, App, Sales | aktuelle Themen und öffentliche Konversation | vorbereitet |
| Reddit Ads | Bekanntheit, Traffic, Leads, App, Sales | Community-, Keyword- und Interessen-Kontext | vorbereitet |
| Snapchat Ads | alle sechs Kernziele | Mobile Video, AR und App-Promotion | vorbereitet |

Meta konsolidiert seine Kampagnenziele auf Awareness, Traffic, Engagement, Leads, App Promotion und Sales.[1] Google verwendet dieselben Businessziele als Guidance, während der Kampagnentyp Inventar und Optimierung bestimmt.[2] OpenAI dokumentiert derzeit CPM, CPC und oCPC; ein oCPC-Setup benötigt ein gemessenes Downstream-Conversion-Event.[3] TikTok gruppiert Ziele in Awareness, Consideration und Conversion.[4] Pinterest dokumentiert Awareness, Consideration, Leads und Sales; App-Install-Anzeigen wurden eingestellt.[5] Microsoft Advertising deckt Search-, Audience- und Performance-Max-Szenarien ab.[6] LinkedIn koppelt Ziele, Optimierungsziele und Gebotsarten eng aneinander.[7] X rechnet und optimiert objektivbezogen.[8] Reddit weist ausdrücklich darauf hin, dass das Ziel Optimierung und abrechenbare Aktion bestimmt.[9] Snapchat bündelt seine Zielauswahl in fünf Obergruppen, die auf die sechs Adbot-Kernziele normalisiert werden.[10]

## Mess- und Confidence-Regeln

| Confidence | Bedeutung |
|---|---|
| niedrig | weniger als zwei vergleichbare Live-Datenquellen oder ein Read-Fehler; keine Budgetallokation |
| mittel | mindestens zwei Plattformen sind vergleichbar, weitere ausgewählte Kanäle besitzen aber keine belastbaren Daten und erhalten 0,00 Budget |
| hoch | alle geeigneten Plattformen besitzen aktuelle, vollständige und über dieselbe Erfolgsmetrik vergleichbare Daten |

Für Meta Awareness sind mindestens 1.000 vollständig gelesene Impressionen und ein vollständiger Mindest-Spend erforderlich. Für Traffic sind mindestens 20 vollständig gelesene `inline_link_clicks` erforderlich. **Engagement verwendet Link-Klicks nicht als Ersatzsignal** und bleibt ohne Messwert, bis eine echte Engagement-Metrik normalisiert ist. Lead-Pläne benötigen vollständige Leadwerte, Sales-Pläne vollständige Käufe oder einen über alle relevanten Rohzeilen vollständigen Conversion-Wert; generische Conversions ersetzen diese zielspezifischen Signale nicht. App-Promotion bleibt ohne Messwert, bis ein echtes App-Install-/App-Event-Signal normalisiert ist. Daten älter als drei Tage werden nicht als aktuelles Performance-Signal verwendet, und future-datierte Zeilen werden bereits in der Abfrage ausgeschlossen. Der Mindest-Spend beträgt intern 20 Währungseinheiten; für Lead/Sales sind mindestens drei bestätigte zielspezifische Ergebnisse erforderlich. Diese Schwellen sind konservative Adbot-Gates und keine Vorgaben der Plattformen.

## Erweiterung um weitere Provider

Ein neuer Provider benötigt drei getrennte Bausteine:

1. einen Account- und Read-Sync-Adapter, der auf das normalisierte Performance-Schema schreibt;
2. ein geprüftes Plattformprofil mit unterstützten Zielen;
3. später einen eigenen Execution-Adapter mit providerbezogenen Limits, Idempotenz und Read-back.

Der Planer selbst muss für den elften Provider nicht neu entworfen werden. Das bewusste Produktlimit liegt derzeit bei zehn auswählbaren Kanälen.

## Bekannte Grenzen dieser Stufe

Der Planer aggregiert die letzten 30 Tage. Saisonale Effekte, Margen, Offline-Conversions, Customer Lifetime Value, inkrementeller Lift, Attribution zwischen Kanälen und kreative Sättigung werden noch nicht modelliert. Mehrere verbundene Konten derselben Plattform werden absichtlich blockiert, bis der Nutzer ein Zielkonto auswählt. Neue oder inaktive Kanäle werden weder als Gewinner bezeichnet noch mit einem geschätzten Budget versehen. Die aktuelle Logik vergleicht Plattformen; die Auswahl des erfolgreichsten Anzeigen- oder Creative-Formats innerhalb einer Plattform benötigt einen separaten, ebenfalls datenbasierten Vertrag.

## Nächste sichere Ausbaustufe

1. Google-Ads-Connector und normalisierte Insights ergänzen, damit erstmals zwei Plattformen real vergleichbar sind.
2. Für neue Kanäle eine ausdrücklich getrennte Messphase entwerfen. Ein kleines Testbudget darf dort nur nach separater Freigabe eingesetzt und niemals als Erfolgsoptimierung bezeichnet werden.
3. Strategiepläne versioniert speichern und Nutzerfreigaben auditieren.
4. Simulation gegen historische Tagesdaten und Holdout-Evaluation aufsetzen.
5. Execution-Adapter zunächst im Shadow Mode betreiben: Entscheidungen protokollieren, aber nicht schreiben.
6. Erst nach erfolgreicher Simulation einzelne Budgetänderungen mit kleinen Caps aktivieren.
7. Danach TikTok, Pinterest und Microsoft Advertising priorisieren; weitere Provider folgen über denselben Vertrag.

## Quellen

[1]: https://www.facebook.com/business/help/1438417719786914
[2]: https://support.google.com/google-ads/answer/7450050?hl=en
[3]: https://help.openai.com/en/articles/20001210-create-campaigns-for-chatgpt-ads
[4]: https://ads.tiktok.com/help/article/choose-right-objective?redirected=1
[5]: https://help.pinterest.com/en/business/article/campaign-objectives
[6]: https://about.ads.microsoft.com/en/get-started/achieve-your-advertising-goals
[7]: https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/campaign-objectives?view=li-lms-2026-08
[8]: https://business.x.com/en/advertising/campaign-types
[9]: https://www.business.reddit.com/learning-hub/articles/ad-objectives
[10]: https://businesshelp.snapchat.com/s/article/objectives-overview
