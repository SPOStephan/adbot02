# Meta CAPI: Diagnose „Connection pending“

Stand: 3. August 2026

## Offizielle Meta-Vorgaben

Meta dokumentiert für die Conversions API einen `POST` an `/{PIXEL_ID}/events`. Eine erfolgreiche Testantwort enthält insbesondere `events_received: 1`.[1] Der `test_event_code` dient der Prüfung im Reiter **Test Events** und soll nach erfolgreicher Verifikation aus produktiven Payloads entfernt werden.[2] Nach Beginn des Ereignisversands kann die reguläre Übersicht laut Meta bis zu **20 Minuten** benötigen, bis empfangene Ereignisse verifiziert werden können.[2]

## Produktiver Befund

- Für `immo01` wurde am **3. August 2026 um 09:21:14 UTC** eine neue Bewerbung gespeichert.
- Der Datensatz enthält eine erzeugte Meta-Event-ID; der Submit- und Deduplizierungspfad wurde somit ausgeführt.
- Zum Prüfzeitpunkt sind Meta-Tracking, Pixel-ID und Eventname aktiv; verschlüsseltes CAPI-Token und Test-Event-Code sind vorhanden.
- Die Produktionsprotokolle enthalten für diesen Submit keinen HTTP- oder Netzwerkfehler. Die bisherige Implementierung wertet jedoch nur den HTTP-Status aus und protokolliert eine erfolgreiche Meta-Antwort einschließlich `events_received` nicht. Ein HTTP-2xx allein beweist daher noch nicht, dass Meta genau ein Ereignis angenommen hat.
- Die laufende Implementierung nutzt Graph API `v25.0`; Metas aktuelle Dokumentation zeigt `v26.0`.[1] Vor einer Versionsänderung wird zuerst die tatsächliche Antwort des vorhandenen Endpunkts sicher und ohne neue Bewerbung geprüft.

## Direkte Prüfung im Meta Events Manager

Nach Auswahl von **Events testen → Kanal Website** zeigt Meta für den früheren erfolgreichen Test einen verarbeiteten Browser-Lead und einen serverseitigen Lead mit derselben Event-ID. Das Serverereignis ist ausdrücklich als **dedupliziert** gekennzeichnet. Damit ist belegt, dass Pixel, CAPI-Token, Datenquellen-ID und Deduplizierung grundsätzlich funktionieren; der gleichzeitig in den Einstellungen sichtbare Status **Connection pending** ist für diesen Test kein verlässlicher Gegenbeweis.

Für die neu um **11:21 Uhr lokaler Zeit** gespeicherte Bewerbung ist in derselben Testansicht dagegen weder ein Browser- noch ein Server-Lead mit der neuen Event-ID sichtbar. Der Bewerbungsdatensatz selbst wurde erfolgreich erzeugt und enthält eine neue Event-ID. Die noch fehlende Meta-Antwortprotokollierung verhindert rückwirkend die Unterscheidung zwischen einem angenommenen, verzögert angezeigten Ereignis und einem HTTP-2xx-Payload ohne `events_received: 1`.

Ein ereignisfreier POST an denselben CAPI-Endpunkt wurde bis zur Payload-Validierung akzeptiert und erst wegen des absichtlich leeren `data`-Arrays abgelehnt. Eine zuvor bei einem ungeeigneten Lesezugriff angezeigte Berechtigungsmeldung ist daher kein Nachweis für ein ungültiges CAPI-Token.

## Sicherer Server-Live-Nachweis ohne Bewerbung

Am **3. August 2026 um 11:36 Uhr lokaler Zeit** wurde über exakt denselben produktiven Codepfad ein einmaliges, synthetisches Server-Testereignis gesendet. Dabei wurde kein Bewerbungsdatensatz angelegt, kein Upload erzeugt und kein Zugangstoken ausgegeben. Die Meta-API antwortete mit **HTTP 200** und `events_received: 1`; die Antwort enthielt außerdem eine technische Trace-ID.

In **Events testen → Website** erschien unmittelbar danach der zugehörige Lead mit derselben Event-ID als **Server / Verarbeitet**. Damit sind der aktuelle Token, die Pixel-/Datensatz-ID, der gespeicherte Testcode, der Endpunkt und die Payload grundsätzlich funktionsfähig.

Direkt im Anschluss zeigte die Meta-Einstellungsseite unter **Conversions API** trotzdem weiterhin **Connection pending**. Dieser UI-Status wird somit nachweislich nicht synchron mit erfolgreich verarbeiteten Serverereignissen aktualisiert und darf nicht als technische Fehlermeldung für die aktuelle Integration interpretiert werden.

Nach diesem erfolgreichen Nachweis wurde der temporäre Testevent-Code aus der produktiven Funnel-Konfiguration entfernt. Eine direkte Vorher-/Nachher-Prüfung bestätigte, dass der verschlüsselte CAPI-Token dabei unverändert vorhanden blieb. Künftige echte Bewerbungen werden damit als reguläre Produktionsereignisse gesendet und nicht mehr ausschließlich in der Testevent-Ansicht einsortiert.

Der frühere Bewerbungsversuch um 11:21 Uhr bleibt rückwirkend nicht vollständig aufklärbar, weil die damalige Produktionsversion zwar HTTP-Fehler, aber weder Metas `events_received` noch die Trace-ID protokollierte. Die jetzt implementierte Antwortauswertung schließt genau diese Diagnoselücke für künftige Ereignisse.

## Technische Absicherung

Die CAPI-Auswertung liest jetzt Metas strukturierte Antwort, gibt `events_received` als `eventsReceived` zurück und behandelt auch ein HTTP-2xx ohne bestätigtes Ereignis als Fehler. Protokolliert werden ausschließlich Event-ID, Pixel-ID, HTTP-Status, bestätigte Ereigniszahl, technische Fehlercodes und Trace-ID; Token, rohe Meta-Fehlermeldungen und Bewerberdaten werden nicht protokolliert.

Die abschließende Prüfung war erfolgreich: **TypeScript ohne Fehler, 20 Testdateien mit 60 bestandenen Tests und erfolgreicher Produktionsbuild**. Ein einmaliger Fünf-Sekunden-Timout des externen Resend-Zugangstests war beim gezielten Wiederholungslauf nicht reproduzierbar; der anschließende vollständige Lauf bestand einschließlich dieses Tests.

## References

[1]: https://developers.facebook.com/documentation/ads-commerce/conversions-api/using-the-api "Meta: Using the Conversions API"
[2]: https://www.facebook.com/business/help/ServerTestEventsTool "Meta Business Help: Test Your Server Events"
