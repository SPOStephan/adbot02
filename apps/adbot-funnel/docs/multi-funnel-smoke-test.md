# Mehr-Funnel-Smoke-Test

**Autor:** Manus AI
**Stand:** 27. Juli 2026

## Laufende Verifikation

Die geschützte Route `/admin` wurde in der bereits authentifizierten Browsersitzung gegen den produktionsnahen Entwicklungsserver geöffnet. In den ersten beiden Erfassungen blieb die Seite im globalen Suspense-Zustand **„Bereich wird geladen …“**. Zu diesem Zeitpunkt waren weder Funnel-Karten noch ein fachlicher API-Fehler sichtbar. Vor einer Bewertung von Bestandsfunnel, Slug, Status und Bewerbungszahlen werden deshalb zunächst Client-, Netzwerk- und Dev-Server-Protokolle geprüft.

Die Protokollprüfung zeigte anschließend erfolgreiche Antworten für `auth.me` und `funnel.funnels` mit HTTP-Status 200. Nach Abschluss des initialen Authentifizierungs- und Datenabrufs erschien die Funnel-Bibliothek vollständig. Der bestehende Produktionsfunnel wurde unverändert als **„Deine Karriere bei uns“**, Slug `/f/karriere` und Status **„Veröffentlicht“** dargestellt. Die Bibliothek zeigte genau einen Funnel, eine zugeordnete Bewerbung und eine neue Bewerbung. Damit bleiben öffentliche URL, bestehende Funnel-Identität und Bewerbungszuordnung nach der Mehr-Funnel-Normalisierung erhalten.

Die öffentliche Bestands-URL `/f/karriere` wurde anschließend direkt geöffnet. Der vierstufige Funnel erschien mit unveränderten Inhalten, Fortschrittsanzeige und aktiver Aktion **„Jetzt starten“**; die neue Statusprüfung sperrt den veröffentlichten Bestandsfunnel folglich nicht. Beim anschließenden Rücksprung nach `/admin` war erneut kurz der globale Ladehinweis sichtbar, was dem bereits protokollierten asynchronen Authentifizierungsabruf entspricht und nicht als fachlicher Fehler gewertet wird.

Die Aktion **„Bearbeiten“** des Bestandsfunnels führte korrekt auf die stabile ID-Route `/admin/funnels/10000000-0000-4000-8000-000000000001/editor`. Damit ist belegt, dass die Bibliothek nicht den veränderbaren Slug, sondern die bestehende Funnel-UUID für Admin-Navigation und Bearbeitung verwendet.

Der Editor lud den Bestandsfunnel anschließend vollständig mit dem unveränderten Titel **„Deine Karriere bei uns“**, allen vier bisherigen Seiten, den vorhandenen Seitentexten sowie der mobilen Live-Vorschau. Die normalisierte Mehr-Funnel-Konfiguration kann damit ohne Inhaltsverlust über die neue ID-Route bearbeitet werden; es war keine riskante Tabellenmigration oder Neuanlage des produktiven Funnels erforderlich.

## Responsive Sichtprüfung

Die Funnel-Bibliothek und die globale Bewerbungsverwaltung wurden bei **1.440 × 900 Pixeln** sowie **390 × 844 Pixeln** vollständig gerendert. Desktop zeigen Sidebar, Kennzahlen, Filter, Funnel-Karte und Bewerbungszeile ohne Überlagerung oder abgeschnittene Primäraktionen. Mobil wechseln beide Seiten erwartungsgemäß in die kompakte Kopfnavigation; Kennzahlen und Funnel-Karte stapeln sich, Filter bleiben bedienbar und die Bewerbungszeile wird als kompakte Karte statt als überbreite Tabelle dargestellt. Die langen Testdaten werden mobil bewusst gekürzt, während Status, Funnel, Datum und Antwortanzahl sichtbar bleiben.

## Automatisierte Funktionsprüfung

TypeScript-Prüfung und Produktions-Build liefen ohne Fehler. Die vollständige Vitest-Suite umfasst nun **9 Testdateien mit 27 erfolgreichen Tests**. Neue Integrationsfälle belegen insbesondere kollisionsfreie Slugs, neue neutrale Vorlagen, tiefe Kopien mit neuen technischen IDs, nicht kopierte Bewerbungen, Admin-Berechtigungen, verlustfreie Bestandsnormalisierung sowie die öffentliche Sperre für Entwürfe, pausierte und archivierte Funnel.

Der kombinierte Filter **„In Bearbeitung“** ist zusätzlich als reine, gemeinsam von UI und Test verwendete Funktion abgesichert. Der Testdatensatz enthält dafür alle relevanten Statusvarianten und bestätigt, dass ausschließlich `reviewing` und `contacted` einbezogen werden. Die produktive Oberfläche wurde mit dem real vorhandenen Bewerbungsdatensatz responsiv gerendert; ein künstliches Umschalten desselben Produktivdatensatzes zwischen zwei Zuständen war damit für den fachlichen Nachweis nicht erforderlich.

Die verbundene externe Browsersitzung war wegen fortlaufend veraltender Elementindizes und einer zeitweisen 504-Antwort nicht stabil genug für den vollständigen Dialogablauf. Deshalb wurde ein reproduzierbarer lokaler Headless-Chromium-Test über das DevTools-Protokoll ergänzt. Er verwendet einen auf zehn Minuten begrenzten, mit dem bestehenden Anwendungsschlüssel signierten Owner-Cookie und bedient ausschließlich die sichtbare React-Oberfläche.

## Browser-Ende-zu-Ende-Test

Der erfolgreiche Lauf legte über **„Neuen Funnel erstellen“** den Entwurf **„E2E Mehr-Funnel 92778982“** mit Slug `/f/e2e-mehr-funnel-92778982` an und wurde auf die neue ID-Editorroute `/admin/funnels/fa2df335-902c-4e0b-ac5a-3f0124715a6e/editor` weitergeleitet. Aus der Bibliothekskarte wurde anschließend über **„Funnel kopieren“** eine unabhängige Kopie mit Slug `/f/e2e-mehr-funnel-92778982-kopie` und eigener Editor-ID `54ca369e-1439-4e3f-994c-24c61b795b01` erzeugt.

Beide Funnel wurden danach über den sichtbaren Archivierungsdialog archiviert. Abschließend prüfte die Testbereinigung, dass keiner der streng auf `e2e-mehr-funnel-<acht Ziffern>` beziehungsweise `-kopie` begrenzten Testfunnel eine Bewerbung besitzt, und entfernte sämtliche während der Diagnose angelegten E2E-Funnel. Der produktive Funnel `karriere` und seine Bewerbung wurden von der Bereinigung weder ausgewählt noch verändert.

Der abschließende erweiterte Lauf verwendete den temporären Funnel **„E2E Mehr-Funnel 93005655“**. Im visuellen Editor wurde der interne Seitenname auf **„Startseite E2E“** geändert. Der Rückweg löste erwartungsgemäß den Dialog **„Ungespeicherte Änderungen verwerfen?“** aus; der Test verwarf die Navigation, speicherte anschließend über den sichtbaren Pending-Button und bestätigte den wieder deaktivierten Speicherzustand.

Danach öffnete der Test die ID-gebundene Einstellungsroute, änderte die nur für den temporären Funnel geltende Benachrichtigungsadresse auf `e2e-93005655@example.com` und bestätigte den Dialog **„Ungespeicherte Einstellungen verwerfen?“** ebenfalls durch Abbruch der Navigation. Nach **„Einstellungen speichern“** wurde die Route vollständig neu geladen; die Adresse war weiterhin identisch vorhanden. Damit sind Dirty-, Bestätigungs-, Pending-, Erfolgs- und Persistenzzustände für Editor und Einstellungen durch reale UI-Interaktion belegt.

Auch dieser Lauf kopierte, archivierte und entfernte beide bewerbungslosen Testfunnel vollständig. Die finale Regression bestand aus erfolgreicher TypeScript-Prüfung, **9 Vitest-Dateien mit 27 bestandenen Tests** und einem erfolgreichen Produktions-Build mit Client- und Server-Bundle.

Nach Abschluss aller Mehr-Funnel-Prüfungen wurde zusätzlich die zuvor freigegebene, eindeutig markierte Testbewerbung des Bestandsfunnels entfernt und ihr Nichtvorhandensein unmittelbar per Supabase-Abfrage bestätigt. Damit verbleiben weder E2E-Testfunnel noch die frühere Testbewerbung in der produktiven Bibliothek.
