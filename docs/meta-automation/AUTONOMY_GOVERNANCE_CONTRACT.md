# Adbot Autonomy Governance Contract

**Autor:** Manus AI  
**Stand:** 29. Juli 2026  
**Geltungsbereich:** Manus-unabhängiger Meta-Kampagnenmanager auf Vercel, Supabase und GitHub  
**Status:** Verbindlicher Produkt- und Testvertrag für die Staging-Implementierung

## 1. Freigegebener Autonomieumfang

Der Kunde hat vier grundsätzliche Produktentscheidungen getroffen. Adbot darf bestehende Budgets erhöhen und senken, Kampagnen pausieren und aktivieren, neue Werbeketten erstellen und neue Anzeigen innerhalb aller nachfolgenden Schutzgrenzen selbstständig aktiv schalten. Das gewünschte Ergebnis einer erfolgreichen Neuerstellung ist `ACTIVE`; PAUSED ist kein regulärer Endzustand einer erfolgreich ausgeführten Launch-Anweisung.

| Aktion | Produktfreigabe | Zusätzliche Ausführungsbedingung |
|---|---:|---|
| Kampagnen- oder Ad-Set-Budget erhöhen | Ja | Kundencap, 20-Prozent-Grenze, Budgetebene, Spend und Cooldown bestanden |
| Kampagnen- oder Ad-Set-Budget senken | Ja | Zusätzlich Meta-Mindestbudget und bisheriger Spend bestanden |
| Kampagne pausieren | Ja | Kein widersprüchlicher oder laufender Plan; Reconciliation nach Update |
| Kampagne aktivieren | Ja | Accountpolicy vollständig, Limits gesetzt, keine offene Sicherheitssperre |
| Neue Kampagne, Anzeigengruppe, Creative und Ad erstellen | Ja | Versionierter Ziel-Blueprint, valide Assets, Domain, Targeting und `validate_only` |
| Neue Anzeige aktiv schalten | Ja | Vollständige Kette, Meta-Reviewstatus und alle Caps werden überwacht |
| Objekt löschen/archivieren | Nein | Nicht Teil des autonomen Allowlist-Vertrags |
| Zielgruppe, Conversion oder Pixel automatisch ersetzen | Nein | Erfordert neuen Blueprint beziehungsweise neue Kundenbestätigung |

## 2. Budgetregeln

Autonomie ist ohne vom Kunden eingetragene Budgetlimits technisch unmöglich. Adbot speichert Geld ausschließlich als Integer in der kleinsten Einheit der Werbekontowährung. Die Währung wird aus Meta gelesen und nach Aktivierung der Policy unveränderlich an diese gebunden. Für ein EUR-Konto entspricht `10000` somit 100,00 EUR. Es findet keine automatische Währungsumrechnung statt.

| Grenze | Verbindliche Regel |
|---|---|
| Account-Tageslimit | Muss pro Werbekonto größer als null gesetzt sein; alle aktiven Kampagnenbudgets plus geplante Erhöhung müssen darunter bleiben |
| Kampagnen-Tageslimit | Muss als Kundendefault gesetzt sein; pro Kampagne kann ein niedrigerer Override gelten |
| Änderung pro 24 Stunden | Absolute kumulierte Budgetänderung eines Objekts höchstens 20 Prozent des beim Beginn des rollierenden 24-Stunden-Fensters geltenden Budgets |
| Cooldown | Nach jeder erfolgreichen Mutation desselben Objekts zwölf Stunden; ein weiterer Plan bleibt nicht wartend, sondern wird später neu berechnet |
| Budgetebene | Adbot mutiert entweder Kampagnenbudget oder Ad-Set-Budget entsprechend dem Livezustand, niemals beides |
| Mindestbudget | Meta-Mindestwerte und bei Senkung der aktuelle Spend werden vor Ausführung erneut geprüft |
| Rundung | Prozentwerte werden konservativ auf ganze Währungsuntereinheiten in Richtung geringerer Auswirkung gerundet |
| Accountsumme | Eine geplante Erhöhung wird gegen den nach Ausführung erwarteten Gesamtwert geprüft, nicht nur gegen den aktuellen Wert |

Die 20-Prozent-Grenze wird als kumulative Grenze modelliert. Zwei Änderungen von jeweils 15 Prozent innerhalb desselben 24-Stunden-Fensters sind nicht zulässig. Eine Gegenänderung hebt den bereits genutzten Änderungsumfang nicht auf. Dadurch kann die Logik die Grenze nicht durch Hin-und-her-Änderungen umgehen.

## 3. Kundenkonfiguration und Aktivierung

Der Autonomiemodus besitzt die Zustände `OFF`, `READY`, `ACTIVE`, `SUSPENDED` und `EMERGENCY_STOP`. Nur `ACTIVE` erlaubt die Beanspruchung neuer Mutationspläne.

| Pflichtinformation | Validierung vor `ACTIVE` |
|---|---|
| Account-Tageslimit | Vorhanden, positiv, richtige Werbekontowährung |
| Kampagnenlimit | Kundendefault vorhanden; Objekt-Override optional und nur niedriger oder ausdrücklich bestätigt |
| Meta-Berechtigung | `ads_management` vorhanden; Granular Scope enthält genau das Werbekonto |
| Meta-Zugangsstufe | Für Kundenproduktion geeigneter Marketing API Access Tier und App-Review-Status |
| Brand Pack | Markenname, Page-/Instagram-Akteur, freigegebene Logos/Farben/Tonregeln und Assetquellen vorhanden |
| Domains | Mindestens eine kundenseitig bestätigte HTTPS-Domain; Landingpage gehört zu einer aktiven Domainpolicy |
| Ziel-Blueprint | Objektivversion, Pflichtassets, Optimierungsziel, Billing Event, Attribution, Targeting- und Compliancefelder vollständig |
| Kill-Switch | Account- und Systemschalter aus; keine offene Reconciliation- oder Complianceabweichung |

Fehlt eine Pflichtinformation, zeigt das Dashboard den konkreten Blocker. Es gibt keinen impliziten Standard, der Ausgaben freischaltet.

## 4. Kampagnenziele

„Alle Kampagnenziele“ bedeutet alle von der verwendeten Meta-API-Version aktuell unterstützten Ziele, für die Adbot einen getesteten, versionierten Blueprint besitzt. Meta unterscheidet aktuell mehrere `OUTCOME_*`-Ziele; deren Pflichtfelder und zulässige Kombinationen unterscheiden sich.[1]

| Blueprintfamilie | Typische zusätzliche Pflichtdaten |
|---|---|
| Awareness | Reichweiten-/Impressionsoptimierung, Zielregion und Budget |
| Traffic | HTTPS-Landingpage, Domain, CTA und Link-Creative |
| Engagement | Page-/Instagram-Akteur und unterstützter Engagementtyp |
| Leads | Instant Form oder bestätigte Conversion-/Domainkonfiguration |
| Sales | Pixel/Dataset, Conversionevent, Domain und gegebenenfalls Katalog/Produktset |
| App Promotion | App-ID, Store-URL, Plattform und app-spezifische Optimierung |

Ein Ziel ohne passende Assets wird nicht durch ein anderes Ziel ersetzt. Legacy-, Reserved-, politische oder regulierte Varianten werden erst aktiviert, wenn ihr eigener Compliancevertrag implementiert und bestanden ist.

## 5. Regionen und Targeting

Der Kunde darf jede von Meta unterstützte Region auswählen. „Alle Regionen“ ist jedoch kein Wildcard-Payload. Adbot speichert pro Blueprint eine explizite, zum Planzeitpunkt erneut validierte Auswahl von Länder-, Regions- oder Ortskennungen. Alters-, Zielgruppen-, Special-Ad-Category-, DSA- und sonstige Meta-Beschränkungen haben Vorrang.[2] [3]

Adbot erstellt keine Custom Audience und keine Custom Conversion autonom. Vorhandene Assets dürfen nur verwendet werden, wenn der Kunde sie freigegeben hat und Meta sie nicht als eingeschränkt meldet. Ein Compliancefehler wird nicht durch breiteres Targeting, eine andere Audience oder Entfernung eines Pflichtfelds umgangen.

## 6. Domains und Landingpages

Der Kunde kann beliebige eigene Domains freigeben. Jede Domain beginnt im Zustand `PENDING` und wird erst nach HTTPS-, Redirect- und Ownership-/Business-Asset-Prüfung `VERIFIED`. Eine Landingpage muss auf einer aktiven Domain liegen; Redirectketten dürfen nicht auf eine andere, unbestätigte registrierbare Domain wechseln.

| Prüfung | Verhalten bei Fehler |
|---|---|
| HTTPS und gültiger Host | Plan wird nicht erzeugt |
| Domain vom Kunden bestätigt | Autonomie bleibt für diese Landingpage gesperrt |
| Redirectziel | Fremde Enddomain führt zu `SUSPENDED` für den Plan |
| Conversion-Domain | Muss bei entsprechenden Kampagnen der von Meta verlangten registrierbaren Domain entsprechen.[4] |
| URL-Schema | Nur `https`; keine Credentials, lokalen Hosts oder nichtöffentlichen IP-Ziele |

## 7. Brand-Assets und neue Creatives

Vorhandene Kundendateien, bereits im Meta-Werbekonto liegende Assets und neu erzeugte Assets sind zulässig. Die Laufzeit besitzt keine Manus-Abhängigkeit. Neue Assets werden über eine standardisierte Provider-Schnittstelle erzeugt; ein Provider ist austauschbar und benötigt eine eigene, vom Kunden kontrollierte API-Konfiguration.

Jedes Asset speichert Provider, Modell beziehungsweise Vorlagenversion, Eingabeparameter, SHA-256, MIME-Typ, Dimensionen, Brand-Policy-Version, Moderationsstatus, Kundenmandant und späteren Meta-Image-Hash. Ein Asset darf erst nach Format-, Größen-, Marken-, URL-, Inhalts- und Meta-`validate_only`-Prüfung verwendet werden.[5] [6]

Neue Creatives dürfen keine nicht bestätigten Leistungsversprechen, Marken, Personenbilder, regulierten Aussagen oder fremden Rechte enthalten. Wenn keine gültige Assetquelle verfügbar ist, wird keine neue Anzeige erstellt; vorhandene Anzeigen können weiterhin im erlaubten Umfang optimiert werden.

## 8. Sicherer Active-Launch

Meta bietet keine anwendungsübergreifende Transaktion für Kampagne, Anzeigengruppe, Asset, Creative und Anzeige. Deshalb ist ein technisch sicherer Active-Launch mehrstufig. Adbot führt für Kampagne, Ad Set und Ad zuerst `validate_only` aus, beansprucht einen idempotenten Plan, erstellt die Elternobjekte vorübergehend ohne Auslieferung, erstellt Creative und Ad, reconciliert alle IDs und aktiviert die Kette erst am Ende.[1] [5] [6]

Der Kundenwunsch „nicht zunächst PAUSED erstellen“ wird als Produktergebnis interpretiert: Ein erfolgreicher Launch hinterlässt keine geplante PAUSED-Kette. Ein transienter PAUSED-Zustand ist als Sicherheitsmechanismus erlaubt und nicht im Dashboard als Kundenentwurf sichtbar. Scheitert ein Zwischenschritt, bleiben angelegte Objekte sicher PAUSED, werden im Audit als `COMPENSATION_REQUIRED` markiert und niemals automatisch aktiviert oder gelöscht.

## 9. Kill-Switch und automatische Sperren

| Ereignis | Automatische Reaktion |
|---|---|
| Reconciliation weicht vom Plan ab | Accountzustand `SUSPENDED`; keine weiteren Mutationen |
| Kundencap erreicht oder nicht lesbar | Keine neue Aktion; bestehende Auslieferung wird nicht ungefragt verändert |
| Token-/Scopefehler | `SUSPENDED`, Reconnect erforderlich |
| Meta-Compliance-/Reviewfehler | Betroffener Plan dauerhaft gesperrt; keine automatische Umgehung |
| Rate-Limit oder vorübergehender Meta-Fehler | Begrenzter Retry mit Backoff; keine doppelte Mutation |
| Unbekannte API-Version/Feldkombination | Fail closed; Blueprint deaktiviert |
| Systemweiter Not-Aus | Keine Planbeanspruchung oder Meta-Mutation über alle Konten |

## 10. Abnahmekriterien

Die Staging-Version gilt erst als bestanden, wenn Tests nachweisen, dass kein Plan ohne Kundencaps ausführbar ist, die kumulative 20-Prozent-Grenze und der 12-Stunden-Cooldown nicht umgehbar sind, ein Retry keine zweite Mutation auslöst, jede Mutation read-after-write reconciliert wird, falsche Währung oder Budgetebene blockiert, fremde Mandantenobjekte unlesbar und unveränderbar bleiben und der Kill-Switch zwischen Vorprüfung und Mutation noch wirksam ist.

Ein echter Staging-Schreibtest darf zunächst nur gegen ein ausdrücklich freigegebenes Werbekonto erfolgen. Bis zum separaten finalen Production-Gate bleibt reale Auslieferung ausgeschlossen.

## References

[1]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account/campaigns "Meta Marketing API – Ad Account Campaigns"
[2]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/special-ad-category "Meta Marketing API – Special Ad Categories"
[3]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-campaign "Meta Marketing API – Ad Set"
[4]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account/ads "Meta Marketing API – Ad Account Ads"
[5]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-creative "Meta Marketing API – Ad Creative"
[6]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-image "Meta Marketing API – Ad Image"
