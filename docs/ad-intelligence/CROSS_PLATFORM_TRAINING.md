# Plattformübergreifende Adbot Intelligence

**Stand:** 11. September 2026

## Zielbild

Adbot erhält **einen gemeinsamen strategischen Kreativkern** für Meta, ChatGPT Ads, Google Ads und TikTok Ads. Dieser Kern lernt Zielgruppenproblem, Angebot, Nutzenargument, Beleg, Funnel-Stufe, Copy und Creative-Brief. Ein separater Plattformadapter übersetzt das Ergebnis anschließend in die jeweils zulässigen Felder, Längen, Formate und Policy-Grenzen.

Der Briefvertrag ist nicht auf ein Land oder die ersten vier Seed-Ziele beschränkt: Markt, Sprache, Kampagnenziel und zulässige Landingpage werden je Kampagne übergeben. Vorhandene Brand-Assets werden als referenzierte Eingaben priorisiert; fehlen benötigte Formate, fordert der Creative-Brief neue Assets an. Domainfreigabe, Rechte, Brand-Vorgaben und kostenwirksame Veröffentlichung bleiben deterministische Sicherheitsgates außerhalb des Modells.

Damit wird nicht viermal dieselbe Werbestrategie trainiert. Eine neue belastbare Erkenntnis kann allen Plattformen helfen; Besonderheiten wie Google-RSA-Assets, TikTok-Video-Hooks, Meta-Placements oder OpenAI-Chat-Cards bleiben trotzdem strikt getrennt.

## Was bereits gebaut ist

Der versionierte Vertrag `adbot-ad-intelligence-v1` enthält einen normalisierten Brief und ein strukturiertes Kampagnenpaket mit Strategie, Copy, Creative-Brief und Compliance-Hinweisen. Der bestehende Meta-Copy-Flow kann später über `AD_COPY_PROVIDER=adbot_intelligence` auf das private Modell umgestellt werden. Ohne diese explizite Umschaltung bleibt der bestehende OpenAI-Provider unverändert.

Der Seed-Korpus entsteht ausschließlich aus fiktiven Marken, fiktiven Angeboten und Adbot-eigenen Briefing-Spezifikationen. Er enthält weder Kundendaten noch kopierte Fremdanzeigen. Ein günstiger Teacher erzeugt ein bevorzugtes und ein bewusst schwächeres Ergebnis; ein unabhängiger stärkerer Judge akzeptiert nur faktentreue, policy-sichere und klar unterscheidbare Paare.

## Trainingsdaten

Die erste Matrix umfasst zehn Branchen, vier Seed-Ziele und vier Plattformen. Daraus entstehen 160 Situationen. Der deterministische Split reserviert rund 20 Prozent ausschließlich für die Evaluation. Alle vier Plattformvarianten derselben Branche-Ziel-Kombination bleiben gemeinsam in Train oder Eval, damit keine fast identische Strategie aus einem anderen Kanal in das Training durchsickert. Die Ausgabe besteht aus:

| Datei | Zweck |
| --- | --- |
| `records.jsonl` | Auditierbarer Brief, bevorzugte/abgelehnte Antwort, Judge-Ergebnis und Tokenverbrauch |
| `train.jsonl` | Together-kompatibles SFT-Konversationsformat |
| `eval.jsonl` | Unberührter Holdout-Split für Evaluation |
| `preferences.jsonl` | Bevorzugte und abgelehnte Antworten für eine spätere DPO-Stufe |
| `manifest.json` | Herkunft, Verteilung, Modelle, Splitregel und Mengen |

Der Korpus ist ein **Bootstrapping-Datensatz**, kein Leistungsbeweis. Er lehrt Struktur, Plattform-Fit, Faktentreue und Policy-Verhalten. Sobald echte Kampagnen vorliegen, werden nur autorisierte First-Party-Ergebnisse als Performance-Signal ergänzt. Der Retrieval-Loop, der Bibliothek und Winner schon vor dem Fine-Tune in Vorschläge zieht, steht in `docs/ad-intelligence/LEARNING_SYSTEM.md`. Holdout-Situationen und Kundentrennung verhindern Leakage.

## Modellstrategie

Die erste trainierbare Stufe ist ein LoRA-Fine-Tune von `Qwen/Qwen3.5-9B` über Together AI. Together akzeptiert JSONL-Konversationen, validiert Uploads serverseitig und stellt fertige private Modelle über einen dedizierten Endpoint bereit.[1][2]

Ein bezahlter Trainingsjob wird **nicht automatisch** gestartet. Das Hilfsskript lädt und validiert den Datensatz, ruft zuerst die offizielle Kostenschätzung ab und stoppt standardmäßig. Erst `--submit` plus eine exakte Bestätigungsphrase kann einen kostenpflichtigen Job starten. Ein Deployment wird ebenfalls separat erstellt; dedizierte Endpoints werden auch im Leerlauf pro Minute berechnet und müssen bei Nichtnutzung auf null skaliert oder gelöscht werden.[1][3]

## Aktivierung in Adbot

Der reproduzierbare Ablauf lautet:

```bash
# Korpus lokal prüfen
npm run test:ad-intelligence

# Together-Dateien validieren und Preis schätzen; startet noch kein Training
python3 scripts/train-ad-intelligence-together.py

# Erst nach Prüfung der angezeigten Kosten einen bezahlten Job starten
python3 scripts/train-ad-intelligence-together.py \
  --submit \
  --confirm START_ADBOT_LORA_WITH_CHARGES

# Nach dem Deployment blind gegen die bisherige Baseline testen
python3 scripts/evaluate-ad-intelligence.py \
  --candidate-model <project-slug>/<endpoint-name>
```

Die Blind-Evaluation fordert mindestens 60 Prozent gewonnene Fälle, fünf Punkte mittleren Qualitätsvorsprung und null Faktentreue- oder Policy-Ausfälle. Sie erzeugt noch keine Produktionsumschaltung.

Nach bestandenem Offlinevergleich werden folgende Servervariablen gesetzt:

```text
AD_COPY_PROVIDER=adbot_intelligence
TOGETHER_API_KEY=...
AD_COPY_TOGETHER_MODEL=<project-slug>/<endpoint-name>
AD_COPY_TOGETHER_INPUT_EUR_PER_MTOK=...
AD_COPY_TOGETHER_OUTPUT_EUR_PER_MTOK=...
```

Together berechnet den dedizierten Inferenzendpoint zeitbasiert. Die beiden EUR/MTok-Werte sind deshalb keine blind übernommenen Listenpreise, sondern eine von Adbot aus realer Endpoint-Laufzeit und gemessenem Durchsatz abgeleitete Kostenallokation. Beide Werte sind Pflicht; ohne sie verweigert der Provider die Aktivierung.

Bis dahin bleibt `AD_COPY_PROVIDER=openai` der unveränderte Produktionspfad. Der neue Adapter akzeptiert ausschließlich den vollständigen `adbot-ad-intelligence-v1`-Vertrag. Eine ungültige oder falsche Plattformantwort wird verworfen; es gibt keine stillschweigende Veröffentlichung.

## Qualitäts- und Sicherheitsgates

1. **Rechte:** Der automatische Seed darf keine Kundendaten oder Fremdanzeigen enthalten.
2. **Faktentreue:** Claims dürfen nur aus dem Brief stammen; Unsicheres wird zur Prüfung markiert.
3. **Plattform-Fit:** Copy und Creative-Brief werden gegen einen versionierten Adaptervertrag bewertet.
4. **Eval-Isolation:** Kein identischer Brief darf in Training und Evaluation vorkommen.
5. **Kostenkontrolle:** Training und Hosting benötigen getrennte explizite Freigaben.
6. **Produktionskontrolle:** Aktivierung erfolgt erst nach Baseline-vs-Fine-Tune-Evaluation und bleibt über eine einzelne Variable reversibel.
7. **Lernen aus Betrieb:** Erst autorisierte aggregierte First-Party-Performance darf später Beispiele gewichten oder preference-Paare erzeugen.

## Plattformadapter

| Plattform | Hauptausgabe des Adapters |
| --- | --- |
| Meta | Primary Text, Headline, Description, CTA-Intent und placement-spezifische Varianten |
| ChatGPT Ads | `chat_card` mit Titel, Body, Bildreferenz und Ziel-URL; Claims und Landingpage müssen zusammenpassen |
| Google | Responsive-Search-Headline-/Description-Assets sowie getrennte Display-/Demand-Gen-Felder |
| TikTok | Video-Hook, Voice-over, On-Screen-Text, CTA-Intent, 9:16-Creative-Brief und AIGC-Hinweis |

Die im Modell erzeugte Strategie ist gemeinsam. Zeichenlimits, API-Enums, Targeting- und Reviewregeln bleiben deterministischer Code und werden nicht dem Modell überlassen.

## Nächste Ausbaustufe

Nach dem Seed-Training folgt ein fester Evaluationssatz mit Blindbewertung gegen die aktuelle Baseline. Erst bei messbarer Verbesserung wird der Endpoint für einen kleinen internen Canary aktiviert. Danach erweitert Adbot den Korpus kontrolliert um:

- freigegebene interne Werbebeispiele als Retrieval-Kontext, nicht automatisch als Leistungswahrheit;
- eigene autorisierte Kampagnen mit normalisierten Ergebnissen;
- bevorzugte/abgelehnte Varianten aus menschlicher Auswahl;
- Gewinner-/Verliererpaare nur bei ausreichender Auslieferung, vergleichbarer Zielsetzung und belastbarer Messung.

## Quellen

[1]: https://docs.together.ai/docs/fine-tuning/quickstart "Together AI Fine-tuning Quickstart"
[2]: https://docs.together.ai/docs/fine-tuning/data-preparation "Together AI Data Preparation"
[3]: https://docs.together.ai/docs/fine-tuning/deployment "Together AI Fine-tuned Model Deployment"
[4]: https://developers.openai.com/ads/api-reference/ads "OpenAI Ads API – Ads"
[5]: https://www.facebook.com/business/ads-guide "Meta Ads Guide"
[6]: https://support.google.com/google-ads/answer/7684791 "Google Responsive Search Ads"
[7]: https://ads.tiktok.com/help/article/video-ads-specifications "TikTok Video Ads Specifications"
