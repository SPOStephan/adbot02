# Meta Pixel und Conversions API einrichten

Die Integration ist **pro Funnel** konfigurierbar. Ist Meta-Tracking aktiviert, lädt der öffentliche Funnel den Browser-Pixel automatisch. Eine Bewerbung gilt erst dann als Conversion, wenn sie erfolgreich in der Datenbank gespeichert wurde. Der Funnel meldet dieses Ereignis standardmäßig als Meta-Standardereignis `Lead`. Browser-Pixel und optionale Conversions API verwenden denselben Eventnamen und dieselbe Event-ID, damit Meta beide Signale deduplizieren kann.[1] [2]

## Konfiguration im Admin-Bereich

Öffnen Sie **Funnel-Bibliothek → gewünschter Funnel → Einstellungen → Meta Conversion Tracking**. Hinterlegen Sie die numerische Pixel-ID und belassen Sie den Eventnamen im Regelfall bei `Lead`. Ein serverseitiges Zugangstoken ergänzt den Browser-Pixel um die Conversions API; ein Test-Event-Code dient ausschließlich der vorübergehenden Prüfung im Events Manager.[1] [3]

| Feld | Verwendung |
|---|---|
| Meta-Tracking aktiv | Lädt den Pixel automatisch und meldet erfolgreiche Bewerbungen als Conversion |
| Meta Pixel-ID | Numerische ID der Datenquelle; gilt für Browser-Pixel und Conversions API |
| Conversion-Event | Standardmäßig `Lead`; muss für Browser- und Serverereignis identisch sein |
| Zugangstoken | Optionales serverseitiges Token für die Conversions API; wird mit AES-256-GCM aus dem serverseitigen `JWT_SECRET` verschlüsselt |
| Test-Event-Code | Temporärer Code aus dem Meta Events Manager; vor dem Produktivbetrieb wieder leeren |

Ohne Zugangstoken arbeitet der Funnel ausschließlich mit dem Browser-Pixel. Mit Zugangstoken sendet der Server dasselbe Ereignis zusätzlich an die Conversions API. Das Token wird nicht an den Browser ausgeliefert und im Admin-Bereich nach dem Speichern nicht wieder angezeigt; sichtbar bleibt nur, ob ein Token vorhanden ist.

## Ereignisfluss

| Reihenfolge | Verhalten |
|---|---|
| 1 | Bei aktiviertem Meta-Tracking lädt der öffentliche Funnel den konfigurierten Browser-Pixel automatisch. |
| 2 | Beim Absenden erzeugt der Browser eine eindeutige Event-ID und übermittelt sie mit der Bewerbung an den Server. |
| 3 | Die Bewerbung wird vollständig und atomar gespeichert. Ein Speicherfehler erzeugt keine Conversion. |
| 4 | Nach erfolgreicher Speicherung sendet der Browser das konfigurierte Ereignis mit `eventID`. |
| 5 | Bei vorhandenem Zugangstoken sendet der Server dasselbe Ereignis mit `event_id` an die Conversions API.[1] [2] |
| 6 | Erst danach zeigt der Funnel die Erfolgsnachricht oder öffnet die konfigurierte HTTPS-Weiterleitung. Ein Meta-Fehler blockiert diesen Erfolg nicht. |

Die Conversions API übermittelt nur die für die Zuordnung vorgesehenen Daten. E-Mail-Adresse, Telefonnummer und Vorname werden vor dem Versand normalisiert und mit SHA-256 gehasht. Die interne Bewerbungs-ID wird ebenfalls gehasht. IP-Adresse, User-Agent sowie vorhandene Meta-Browserkennungen (`_fbp`/`_fbc`) werden im Serverereignis verwendet. Lebenslauf, Freitextantworten und vollständige Bewerbungsinhalte werden nicht an Meta gesendet.

## Test im Meta Events Manager

Erzeugen Sie im Meta Events Manager unter **Test Events** einen Test-Event-Code und speichern Sie ihn vorübergehend im Funnel. Aktivieren Sie Meta-Tracking und senden Sie danach eine eindeutig als Test markierte Bewerbung erfolgreich ab. Der Testcode allein erzeugt noch kein Ereignis. Im Events Manager sollte `Lead` mit Browser- und – bei vorhandenem Token – Serversignal erscheinen und anhand der gemeinsamen Event-ID dedupliziert werden.[2] [3] Entfernen Sie anschließend den Test-Event-Code und löschen Sie den Testdatensatz nach der fachlichen Kontrolle.

Bei einer Weiterleitung muss die Zieladresse absolut sein und mit `https://` beginnen. Sie wird ausschließlich nach bestätigter Bewerbungsspeicherung und nach Auslösung des Browserereignisses geöffnet. Die bestehende Erfolgsnachricht bleibt der sichere Standardmodus.

## Datenschutz- und Betriebsgrenzen

Der Funnel zeigt auf ausdrückliche Produktentscheidung **keine zusätzliche Meta-Einwilligungscheckbox** im Bewerbungsformular. Der Schalter **Meta-Tracking aktiv** steuert den gesamten technischen Versand. Die verantwortliche Stelle muss vor Aktivierung selbst sicherstellen, dass Datenschutzerklärung, Rechtsgrundlage, notwendige Einwilligungs- oder Consent-Management-Prozesse, Widerrufsmöglichkeiten und internationale Datenübermittlungen für den konkreten Einsatz geprüft und korrekt umgesetzt sind.

## References

[1]: https://developers.facebook.com/documentation/ads-commerce/conversions-api/using-the-api "Meta – Using the Conversions API"
[2]: https://developers.facebook.com/documentation/ads-commerce/conversions-api/deduplicate-pixel-and-server-events "Meta – Handling Duplicate Pixel and Conversions API Events"
[3]: https://developers.facebook.com/documentation/ads-commerce/conversions-api/parameters/server-event "Meta – Server Event Parameters"
