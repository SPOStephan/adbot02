# Meta Marketing API v25 – Schreibvertrag für Adbot

**Stand der Prüfung:** 29. Juli 2026  
**Zweck:** Verbindliche externe Grundlage für einen schreibfähigen, kundenseitig begrenzten Meta-Kampagnenmanager. Dieses Dokument beschreibt den offiziellen API-Vertrag; es führt keine Meta-Operation aus.

## 1. Autorisierung und Produktionszugang

Meta beschreibt `ads_management` als die Berechtigung zum Lesen und Verwalten von Werbeobjekten. Wenn eine App nur eigene Werbekonten verwaltet, reicht laut aktueller Autorisierungsseite Standardzugriff auf `ads_management`; für Werbekonten anderer Personen beziehungsweise Kunden ist Advanced Access erforderlich.[1]

Seit Mai 2026 heißt der frühere „Ads Management Standard Access“ **Marketing API Access Tier**. Der Standard-Tier ist **Limited Access**, nach App Review ist **Full Access** möglich. Limited Access ist stark pro Werbekonto begrenzt und laut Meta für Entwicklung, nicht für Produktionsanwendungen mit Live-Werbetreibenden gedacht. Für Full Access nennt Meta aktuell mindestens 500 erfolgreiche Marketing-API-Aufrufe in den letzten 15 Tagen und eine Fehlerquote unter 15 Prozent in den letzten 500 Aufrufen.[1]

Für Adbot als künftige Mehrkundenanwendung lautet das Produktionsgate daher: Advanced Access für `ads_management`, der passende Marketing API Access Tier und alle im App Dashboard verlangten App-Review-/Business-Verifikationsschritte müssen vor der Kundenproduktion erfüllt sein. Der tatsächliche aktuelle Status wird im App Dashboard geprüft; er wird nicht aus einem Token oder aus Annahmen abgeleitet.

## 2. Offizielle Objektkette

Meta modelliert die Werbeauslieferung als Kampagne, Anzeigengruppe, Creative und Anzeige. Die grundlegenden Erstellungskanten in Graph API v25 sind `POST /act_<AD_ACCOUNT_ID>/campaigns`, `POST /act_<AD_ACCOUNT_ID>/adsets`, `POST /act_<AD_ACCOUNT_ID>/adcreatives` und `POST /act_<AD_ACCOUNT_ID>/ads`.[2] [3] [4] [5]

| Objekt | Zentrale Pflicht-/Vertragsfelder | Adbot-Sicherheitsregel |
|---|---|---|
| Kampagne | Name, Ziel, Status und `special_ad_categories`; Budget wahlweise auf Kampagnen- oder Anzeigengruppenebene | Ziel und Special-Ad-Kategorie müssen aus einer validierten Kundenvorlage stammen; kein freier Fallback |
| Anzeigengruppe | Kampagne, Budget, Targeting, Optimierungsziel, Billing Event und je Ziel gegebenenfalls `promoted_object` | Budget nur in Währungsuntereinheiten; Targeting nur aus bestätigter Policy und objektivspezifischem Template |
| Bildasset | Bildbytes an `/adimages`; Rückgabe enthält einen Image-Hash | Asset zuerst validieren, unverändert hashen und kundenspezifisch dem Werbekonto zuordnen |
| Creative | Seite/Instagram-Akteur, Story-/Link-Spezifikation, Ziel-URL, Text und Image-Hash beziehungsweise Media | Nur bestätigte Marke, Domain, CTA und Assetquelle; objektivspezifische Policyprüfung vor Meta-Aufruf |
| Anzeige | Anzeigengruppe, Creative und Status `ACTIVE` oder `PAUSED` | Vor Mutation `validate_only`; nach Mutation Read-after-write und vollständige Reconciliation |

## 3. Budget- und Statusvertrag

Meta erwartet Budgetwerte als Integer in der kleinsten Währungseinheit; für EUR bedeutet dies Cent. Kampagnen- und Anzeigengruppenbudgets dürfen nicht gleichzeitig für dieselbe Struktur verwendet werden. Das Backend muss deshalb vor jeder Änderung die tatsächliche Budgetebene aus dem Live-Snapshot ableiten und darf niemals blind beide Ebenen beschreiben.[3] [6]

Adbot erhält als feste Produktgrenze maximal 20 Prozent Budgetänderung je 24 Stunden und einen Cooldown von 12 Stunden. Diese Grenzen sind strenger als der reine API-Vertrag und werden ausschließlich serverseitig erzwungen. Zusätzlich bleiben kundenseitige Account- und Kampagnen-Tageslimits zwingend; ohne beide Limits ist keine autonome Mutation zulässig.

Kampagnen und Anzeigen unterstützen Statuswerte wie `ACTIVE` und `PAUSED`. Neu erstellte Anzeigen gehen zunächst durch Meta Review und besitzen währenddessen einen effektiven Pending-Status; ein als ACTIVE erstelltes Ad kann nach Freigabe automatisch ausliefern.[4] [7] Der Executor darf ACTIVE daher erst senden, nachdem die gesamte Objektkette lokal validiert wurde, die kundenseitigen Limits bestehen und der konkrete Plan atomar beansprucht wurde.

## 4. Vorabvalidierung und Gegenprüfung

Kampagnen-, Anzeigengruppen- und Anzeigenendpunkte unterstützen `execution_options=["validate_only"]`; für Anzeigen kann `synchronous_ad_review` zusammen mit `validate_only` zusätzliche Integrity-Prüfungen anstoßen.[3] [4] Die synchrone Prüfung ersetzt laut Meta nicht die endgültige Anzeigenprüfung.[7]

Adbot verwendet daher einen zweistufigen Ablauf: Zuerst wird derselbe geplante Payload mit `validate_only` geprüft. Nur bei Erfolg darf der eigentliche Schreibaufruf folgen. Danach wird das Objekt über seine ID erneut gelesen. Weichen Budget, Status, Parent-Bezug, Creative oder Domain vom Plan ab, wird das Werbekonto automatisch gesperrt und es folgt keine weitere autonome Aktion.

## 5. Creative- und Domainvertrag

Bilder können separat an `/act_<AD_ACCOUNT_ID>/adimages` hochgeladen werden; Meta liefert einen Image-Hash, der für ein Creative verwendet werden kann.[5] Ein Link-Creative kann über `object_story_spec.link_data` unter anderem Seite, Image-Hash, Ziel-URL und Nachricht definieren.[4]

Bei Kampagnen, die Daten mit einem Pixel teilen, kann `conversion_domain` für Erstellung oder Aktualisierung einer Anzeige erforderlich sein. Meta erwartet dort nur die registrierbare Domain und nicht die vollständige URL.[3] Adbot speichert deshalb getrennt die vom Kunden bestätigte Domain und die konkrete erlaubte Landingpage. Eine neue URL ist nur zulässig, wenn Host, HTTPS, Redirectziel und Kundenfreigabe die Policyprüfung bestehen.

Neue Brand-Assets werden nicht durch Manus zur Laufzeit erzeugt. Adbot erhält eine austauschbare Provider-Schnittstelle. Jeder erzeugte Binärwert, Prompt-/Vorlagenbezug, SHA-256, MIME-Typ, Dimensionen, Markenrichtlinienversion und Meta-Image-Hash wird im Audit erfasst.

## 6. „Alle Ziele“ erfordert eine Template-Matrix

Meta nennt zahlreiche Ziele, darunter die aktuellen `OUTCOME_*`-Ziele. Pflichtfelder, zulässige Optimierungsziele, Billing Events, `promoted_object`, Attribution, Zeitplan, Conversion-Domain, Katalog-/Pixel-/App-Bezug und Targetingregeln unterscheiden sich je Ziel.[3] [6]

Daraus folgt: Adbot darf „alle Ziele“ nicht über einen generischen freien Payload implementieren. Es benötigt eine versionierte Allowlist von objektivspezifischen Blueprints. Ein Ziel wird erst dann im Autonomiemodus angeboten, wenn sein Blueprint, Meta-`validate_only`-Vertrag und seine Regressionen vorhanden sind. Unbekannte oder nach einem API-Upgrade veränderte Zielkombinationen bleiben automatisch gesperrt.

## 7. Regulatorische und Meta-spezifische Sperren

`special_ad_categories` ist bei neuen und bearbeiteten Kampagnen erforderlich; für Housing, Employment und Credit gelten eingeschränkte Targetingmöglichkeiten.[6] Politische beziehungsweise gesellschaftliche Anzeigen benötigen zusätzliche Autorisierung und Creative-Kennzeichnung.[4] Für EU-regulierte Zielregionen können DSA-Angaben zu Zahler und Begünstigtem erforderlich sein.[7]

Die aktuelle Ad-Set-Dokumentation weist außerdem auf Einschränkungen für Zielgruppen oder Conversions hin, die unzulässige Gesundheits- oder Finanzinformationen vermuten lassen.[8] Adbot darf solche Meta-Fehler niemals automatisch durch Lockerung oder Ersetzung von Compliancefeldern umgehen. Der Account wird für die betroffene Aktion gesperrt und der Kunde erhält den bereinigten Fehlergrund.

## 8. Belastbarer Mindestumfang für die erste schreibfähige Version

| Funktion | Erste unterstützte Form |
|---|---|
| Bestehendes Budget ändern | Kampagnen- oder Anzeigengruppenbudget, niemals beide; maximal 20 Prozent je 24 Stunden |
| Bestehendes Objekt pausieren/aktivieren | Kampagne und Anzeige; nur bei konsistentem Live-Zustand |
| Neue Objektkette | Versionierter Blueprint, nicht aus beliebigen freien Feldern |
| Neues Bildasset | Bestehendes Kundenasset oder externer Provider über standardisierte Schnittstelle |
| Vorabprüfung | Meta `validate_only`; bei Ads zusätzlich optional synchroner Integrity-Check |
| Ausführung | Idempotenter, einmalig beanspruchter Plan mit serverseitiger Allowlist |
| Gegenprüfung | Read-after-write mit Budget-, Status-, Parent-, Creative- und Domainvergleich |
| Fehlerreaktion | Kontoweiser Kill-Switch; keine automatische Umgehung oder weitere Aktion |

## References

[1]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/authorization "Meta Marketing API – Authorization, aktualisiert 5. Mai 2026"
[2]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/basic-ad-creation "Meta Marketing API – Basic Ad Creation, aktualisiert 24. Juni 2026"
[3]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account/campaigns "Meta Marketing API – Ad Account Campaigns, aktualisiert 11. Mai 2026"
[4]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-creative "Meta Marketing API – Ad Creative, aktualisiert 24. März 2026"
[5]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-image "Meta Marketing API – Ad Image, aktualisiert 24. März 2026"
[6]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-campaign-group "Meta Marketing API – Campaign, aktualisiert 11. Mai 2026"
[7]: https://developers.facebook.com/docs/graph-api/reference/adgroup "Meta Graph API – Ad, Graph API v25"
[8]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-campaign "Meta Marketing API – Ad Set, aktualisiert 23. Juli 2026"

## 9. Verifizierte Einzelobjekt-Updates

Status- und Budgetänderungen erfolgen nicht an den Werbekonto-Listenendpunkten, sondern per `POST /<OBJECT_ID>` auf das konkrete Kampagnen-, Anzeigengruppen- oder Anzeigenobjekt. Die offizielle Kampagnenreferenz führt für Einzelupdates unter anderem `daily_budget`, `lifetime_budget`, `status` und `execution_options` auf.[6]

Die offizielle Ad-Set-Referenz dokumentiert denselben Einzelobjektpfad und weist zusätzlich darauf hin, dass ein reduziertes Tages- oder Lifetimebudget Meta-Mindestbudgets respektieren muss. Ein neues Lifetimebudget muss insbesondere weiterhin mindestens zehn Prozent über dem bereits ausgegebenen Betrag liegen.[8] Adbot prüft deshalb neben der kundenseitigen 20-Prozent-Grenze zwingend aktuellen Spend, Meta-Mindestbudget und Budgettyp, bevor ein Reduktionsplan ausführbar wird.

Für Ads dokumentiert Meta `POST /<AD_ID>` als Updatepfad. `adset_id` ist nicht veränderbar; archivierte oder gelöschte Anzeigen besitzen stark eingeschränkte Updatefelder. Der Executor erlaubt in der ersten Version daher ausschließlich `status` auf unterstützten, nicht archivierten Liveobjekten. Creative-Wechsel wird nicht als Update eines bestehenden Ads modelliert, sondern als neue Creative-/Ad-Kette mit eigener ID, vollständiger Vorabvalidierung und Auditspur.[7]
