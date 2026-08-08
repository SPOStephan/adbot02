# Produktions-Smoke-Test

**Datum:** 27. Juli 2026  
**Umgebung:** Laufende Vorschau mit produktiver Supabase- und Resend-Konfiguration

## Bestätigter Ablauf

Der öffentliche Funnel `/f/karriere` wurde vollständig über alle vier Schritte durchlaufen. Es wurden ausschließlich eindeutig gekennzeichnete, personenbezugsfreie Testangaben verwendet. Im Kontaktabschluss wurden alle Pflichtfelder ausgefüllt, die Einwilligung aktiviert und ein generiertes PDF mit dem Dateinamen `test-lebenslauf.pdf` und einer Größe von rund 0,02 MB hochgeladen.

Nach dem Absenden wechselte die Anwendung in den erwarteten Erfolgszustand **„Erfolgreich übermittelt – Vielen Dank für deine Bewerbung!“**. Damit sind clientseitige Schrittführung, Validierung, realer Upload-Aufruf und öffentlicher Submit-Endpunkt im zusammenhängenden Browserablauf bestätigt.

| Prüfschritt | Status |
|---|---|
| Vier Funnel-Schritte | Erfolgreich |
| Pflichtfelder und Einwilligung | Erfolgreich |
| PDF-Auswahl und Anzeige | Erfolgreich |
| Submit-Ladezustand | Erfolgreich |
| Erfolgsseite | Erfolgreich |
| Supabase-Datensatz | Erfolgreich; ID `baa0ecd0-620a-47fb-bdfe-39af8317116e`, nach Prüfung wieder entfernt |
| Privater Lebenslauf-Metadatensatz | Erfolgreich; privater Objekt-Key im Test vorhanden, Datenbankverweis anschließend entfernt |
| Resend-Nachricht an `job@boncred.info` | Von Resend und Zielserver angenommen; nutzerseitig im Spam-Ordner gefunden |
| Geschützte Bewerbungsübersicht | Erfolgreich; Gesamt `1`, Neu `1`, zwei Antworten sichtbar |
| Geschützte Bewerbungsdetailseite | Erfolgreich; Kontakt, Freitext, zwei Antworten, Einwilligung, Quelle und Lebenslauf-Metadaten sichtbar |
| Privater Lebenslauf-Abruf | Erfolgreich; `test-lebenslauf.pdf` über zeitlich begrenzte signierte URL geöffnet |

Der Testdatensatz trug den Namen **„TEST Bewerbung – bitte löschen“** und wurde nach der fachlichen Sichtprüfung aus Admin-Bereich und Supabase entfernt.

## Technische Gegenprüfung

Eine anschließende, ausschließlich lesende Supabase-Abfrage fand den Testdatensatz mit dem Status `new`, dem erwarteten Erstellungszeitpunkt und gespeicherten Lebenslauf-Metadaten. Der Datensatz enthält einen privaten Objekt-Key; die Datei besitzt keine dauerhaft öffentliche URL.

Nach Anmeldung zeigte die geschützte Bewerbungsübersicht denselben Testdatensatz mit Name, Unternehmen, Kontakt, Eingang, Status `Neu` und zwei Funnel-Antworten. Damit ist auch die Rückrichtung von Supabase in die Admin-Oberfläche bestätigt.

Die Detailansicht unter `/admin/applications/baa0ecd0-620a-47fb-bdfe-39af8317116e` zeigte sämtliche übermittelten Kontaktdaten, den Freitext, die Antworten `technik` und `3-plus`, den Einwilligungszeitpunkt, die Funnel-Quelle sowie die Datei `test-lebenslauf.pdf` mit Download-Aktion.

Die Aktion **„Lebenslauf öffnen“** erzeugte erfolgreich eine zeitlich begrenzte signierte Download-URL und öffnete das hochgeladene PDF. Dadurch ist der vollständige private Dateiweg vom Upload über die Metadaten bis zum autorisierten Abruf bestätigt, ohne eine dauerhafte öffentliche Datei-URL zu verwenden.

Der reale tRPC-Submit antwortete mit HTTP 200 und `notificationSent: true`. Diese Rückgabe entsteht nur, wenn der Resend-Sende-Endpunkt die Anfrage erfolgreich angenommen hat. Der verwendete Resend-Schlüssel ist sicherheitshalber auf **„send only“** beschränkt und darf deshalb die Liste versendeter E-Mails beziehungsweise den späteren Zustellstatus nicht abfragen. Die tatsächliche Zustellung wurde anschließend getrennt im Resend-Dashboard und nutzerseitig im Spam-Ordner von `job@boncred.info` bestätigt.

## Zustellungsdiagnose nach Nutzerprüfung

Der Nutzer meldete anschließend, dass die Testnachricht im Postfach `job@boncred.info` nicht auffindbar war. Das authentifizierte Resend-Dashboard zeigt denselben Versanddatensatz mit Empfänger `job@boncred.info`, dem erwarteten Betreff und dem Status **Delivered**. Damit wurde die Nachricht laut Resend vom empfangenden Mailserver angenommen; die Sichtbarkeit im Postfach beziehungsweise eine nachgelagerte serverseitige Filterung bleibt separat zu klären.

Das Versanddetail weist die Resend-ID `9dea1823-decd-45bf-9099-e93afc652585`, den Absender `bewerbung@boncred.info`, den Empfänger `job@boncred.info` sowie die Ereignisse **Sent** und **Delivered** jeweils am 27. Juli 2026 um 20:37 Uhr aus. Inhalt und Betreff entsprechen der abgesendeten Testbewerbung.

Das aufgeklappte Zustellereignis enthält die SMTP-Antwort **`250 2.0.0 Ok: queued as D96AFA62BD6`**. Der Ziel-Mailserver hat die Nachricht damit ausdrücklich angenommen und einer internen Queue zugeordnet. Die weitere Suche muss deshalb beim Zielpostfach, dessen Spam-/Quarantänefiltern, Weiterleitungen oder dem Mailhosting erfolgen und nicht beim Funnel-Submit oder Resend-API-Aufruf.

Die Resend-Domain `boncred.info` wird im Dashboard als **Verified** in der Region Ireland (`eu-west-1`) geführt. Die öffentliche DNS-Prüfung zeigt `w021dd24.kasserver.com` als MX für `boncred.info`, `feedback-smtp.eu-west-1.amazonses.com` als MX für `send.boncred.info`, einen vorhandenen Resend-DKIM-Schlüssel sowie eine DMARC-Richtlinie `p=none`. Die technische Absenderdomain ist damit eingerichtet; der Zielserver bei ALL-INKL/Kasserver hat die Nachricht angenommen.

Im Resend-Domainbereich sind sowohl der DKIM-TXT-Eintrag `resend._domainkey` als auch MX und SPF für die Return-Path-Subdomain `send` jeweils mit **Verified** ausgewiesen. Damit gibt es keinen Hinweis auf eine fehlerhafte Resend-Domainverifizierung oder einen abgewiesenen Versand.

Die Resend-Nachrichtenvorschau rendert den erwarteten Betreff, Funnel-Titel, alle Testkontaktdaten, beide Antworten und den Lebenslauf-Dateinamen vollständig. Eine leere oder fehlerhaft aufgebaute Nachricht kann als Ursache der Nichtauffindbarkeit ausgeschlossen werden.

Die Resend-Insights melden einen gültigen DMARC-Eintrag, eine vorhandene Plain-Text-Version, geringe Nachrichtengröße, einen geeigneten Absender ohne `no-reply` sowie keine problematischen Bilder oder Links. Als einzige allgemeine Verbesserung wird der Versand über eine eigene Subdomain empfohlen; dies erklärt jedoch keine nachträgliche Ablage nach der bereits bestätigten SMTP-Annahme.

## Nutzerbestätigung und Testdatenbereinigung

Der Nutzer korrigierte die erste Rückmeldung: Die Nachricht war erfolgreich zugestellt und im Spam-Ordner von `job@boncred.info` auffindbar. Damit sind Submit, Resend-Verarbeitung, SMTP-Annahme und tatsächliche Postfachzustellung bestätigt; die Spam-Einsortierung bleibt eine Frage der Inbox-Platzierung und kein Funktionsfehler des Funnels.

Nach dieser Bestätigung wurde die freigegebene Testbewerbung `baa0ecd0-620a-47fb-bdfe-39af8317116e` entfernt. Vor der Löschung wurden sowohl die feste UUID als auch die Kontaktmarkierung **„TEST Bewerbung – bitte löschen“** geprüft. Eine anschließende Abfrage bestätigte, dass der Datensatz nicht mehr vorhanden ist.

Mit der Bewerbungszeile wurde auch der einzige Datenbankverweis auf den privaten Test-Lebenslauf entfernt. Die Speicherintegration stellt bewusst keine physische Objektlöschung bereit; ohne gespeicherten Schlüssel existiert in Anwendung und Admin-Bereich kein Zugriffspfad mehr auf die Datei.
