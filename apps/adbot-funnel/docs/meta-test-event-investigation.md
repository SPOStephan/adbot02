# Meta-Testevent-Diagnose

## Produktive Ausgangslage

Am 3. August 2026 wurde der geschützte Adminbereich unter `https://freelancer.boncred.info/admin` geprüft. Er enthält zwei veröffentlichte Funnels: `immo01` mit zwei Bewerbungen und `karriere` mit einer Bewerbung. Der Funnel `immo01` wurde zuletzt am 3. August 2026 geändert; `karriere` zuletzt am 27. Juli 2026.

Die aktuellen Produktionsprotokolle enthalten in den letzten 200 Einträgen weder einen protokollierten Meta-Conversions-API-Fehler noch einen sonstigen Meta-bezogenen Eintrag. Da die bestehende Implementierung nur Fehler protokolliert, belegt dies allein weder den erfolgreichen Versand noch das Ausbleiben eines Versandversuchs.

Der zuletzt geänderte Funnel `immo01` hat die ID `67b175e1-2b84-4c6e-8cd6-425b6a3dc1f5`. Sein geschützter Editor und die bestehende öffentliche Vorschau laden fehlerfrei. Die sieben Funnel-Seiten einschließlich Kontaktseite sind vorhanden; die Meta-Konfiguration wird im nächsten Schritt über die zugehörige Einstellungsseite geprüft.

Die produktive Einstellungsseite von `immo01` lädt vollständig und enthält die vorgesehenen getrennten Bereiche für Browser-Pixel, optionales serverseitiges Token und Test-Event-Code. Bis zu diesem Punkt wurden keine Werte verändert oder gespeichert.

## Vorläufiger Hauptbefund

Im produktiven Funnel `immo01` sind die Pixel-ID `968238842859576`, das Conversion-Ereignis `Lead` und ein verschlüsseltes serverseitiges Zugangstoken vorhanden. Der Schalter **„Meta-Tracking aktiv“ ist in der sichtbaren gespeicherten Konfiguration jedoch ausgeschaltet**. In diesem Zustand beendet die Serverlogik den Meta-Versand vor jeder API-Anfrage mit `tracking_not_consented`; auch der Browser-Pixel wird nicht geladen. Ein gespeicherter Test-Event-Code allein kann daher kein Ereignis im Events Manager erzeugen.

Der Schalterzustand wird zusätzlich über die öffentliche Funnel-Konfiguration technisch gegengeprüft, bevor eine Änderung empfohlen oder vorgenommen wird.

Die öffentliche tRPC-Konfiguration bestätigt `metaTracking.enabled: false` für `immo01`. Gleichzeitig sind das verschlüsselte Zugangstoken und ein Test-Event-Code in der geschützten Admin-Konfiguration gespeichert. Damit ist die Ursache eindeutig: **Testcode, Pixel-ID und Token sind vorhanden, aber der globale Meta-Tracking-Schalter blockiert Browser- und Serverereignis vor dem Versand.**

Zusätzlich gilt: Nach einer Aktivierung erzeugt der Testcode nicht selbständig ein Ereignis. Erst eine neu erfolgreich abgesendete Bewerbung löst `Lead` aus.

## Bestätigte Korrektur

Der Administrator übernahm die Aktivierung anschließend selbst und bestätigte, dass Daten an Meta gesendet werden. Pixel-ID, Eventname, verschlüsseltes Zugangstoken und Test-Event-Code wurden durch die Diagnose nicht offengelegt oder verändert.

## Zu prüfende Bedingungen

Ein serverseitiges Meta-Testereignis wird ausschließlich nach einer **neu erfolgreich gespeicherten Bewerbung** ausgelöst, wenn Meta-Tracking im Funnel aktiviert ist, ein Zugangstoken vorliegt und eine Meta-Event-ID mitgesendet wurde. Ein nur gespeicherter Test-Event-Code sendet selbst noch kein Ereignis.

## Abschließende Produktentscheidung

Auf ausdrücklichen Wunsch wurde die separate Meta-Einwilligungscheckbox anschließend vollständig aus dem Bewerbungsformular entfernt. Bei aktiviertem Funnel lädt der Pixel nun automatisch; nach erfolgreicher Speicherung melden Browser-Pixel und – sofern konfiguriert – Conversions API das Ereignis mit derselben Event-ID. Die technische Änderung und das vollständige Ausbleiben der früheren Checkbox sind in [`visual-qa-meta-auto.md`](visual-qa-meta-auto.md) dokumentiert.
