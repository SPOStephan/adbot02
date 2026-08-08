# Visuelle QA: automatisches Meta-Tracking ohne Formular-Checkbox

## Entwicklungsbuild

- Die vollständige Desktopansicht der Einstellungen von `immo01` wurde bei **1280 × 900** geprüft.
- Der Schalter **„Meta-Tracking aktiv“** beschreibt jetzt eindeutig, dass der Browser-Pixel automatisch geladen und jede erfolgreich gespeicherte Bewerbung als Conversion gemeldet wird; bei vorhandenem Token kommt dieselbe serverseitige Meldung hinzu.
- Das frühere Eingabefeld **„Text der freiwilligen Tracking-Einwilligung“** und sein Hilfetext sind vollständig aus der Admin-Oberfläche entfernt.
- Pixel-ID, Eventname, verschlüsselter Tokenstatus und Test-Event-Code bleiben unverändert administrierbar. Die Karte nutzt den durch das entfernte Feld frei gewordenen Raum ohne sichtbare Lücke oder Überlappung.
- Die öffentliche Startseite von `immo01` bleibt im Desktop-Build unverändert lesbar und responsiv; Datenschutz und Impressum bleiben im Footer erreichbar.

## Browserzustand

Der verbundene Benutzerbrowser blieb beim ersten Navigationsversuch auf der bereits geöffneten produktiven Einstellungsseite. Diese noch nicht aktualisierte Produktionsansicht wurde daher **nicht** als Nachweis für den Entwicklungsbuild gewertet und es wurden dort keine weiteren Werte gespeichert oder verändert. Mit einer eindeutigen QA-URL ließ sich der Entwicklungs-Funnel anschließend korrekt öffnen. Der CTA wechselt fehlerfrei zu Schritt 2 von 7; Sachkunde-, Berufserfahrungs-, Mehrfachauswahl-, Selbstbeschreibungs- und Startzeitantworten aktivieren jeweils die Weiter-Navigation und führen korrekt zum Kontaktformular in Schritt 7 von 7. Dort erscheinen ausschließlich Kontaktfelder, optionaler Lebenslauf und die notwendige Datenschutz-Einwilligung. Die separate Meta-Checkbox, ihr Text und die Kennzeichnung „Optional“ sind vollständig verschwunden. Es wurde keine Bewerbung abgesendet.

Der untere Formularbereich wurde separat vollständig geprüft: Die notwendige Datenschutz-Checkbox, Zurück-Schaltfläche und „Bewerbung absenden“ bleiben korrekt ausgerichtet und bedienbar. Zwischen Datenschutzzeile und Aktionen befindet sich weder ein leerer Abstandshalter noch eine verbliebene Meta-Komponente.

Die Protokolle des vollständigen QA-Durchlaufs enthalten keine Browser- oder Serverfehler und keine fehlgeschlagenen Requests. Da keine Bewerbung abgesendet wurde, gab es erwartungsgemäß weder einen `funnel.submit`-Aufruf noch einen Request an `facebook.com/tr` oder `graph.facebook.com`.

## Smartphonebreite

Bei **390 × 844** stapeln sich Meta-Aktivierung, Pixel-ID, Eventname, CAPI-Tokenstatus und Testcode ohne horizontales Überlaufen. Der längere automatische Tracking-Hinweis bleibt lesbar neben dem Schalter, die frühere Consent-Textfläche hinterlässt keine leere Karte, und beide Speichern-Aktionen bleiben klar erreichbar. Die öffentliche Startseite behält ihre mobile Typografie, Bildbreite, CTA-Abstände sowie Datenschutz- und Impressumslinks unverändert bei.
