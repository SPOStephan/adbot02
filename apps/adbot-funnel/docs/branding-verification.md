# Branding-Erweiterung: Sichtprüfung

Stand: 28. Juli 2026

## Geprüfte Ansichten

Der öffentliche Bestandsfunnel `/f/karriere` wurde bei 1440 × 1000 Pixeln und 390 × 844 Pixeln vollständig gerendert. Header, Fortschritt, Startseiten-Überzeile, Überschrift, Beschreibung, Vorteile, Handlungsbutton, Illustration und Footer bleiben ohne horizontales Überlaufen lesbar. Die neuen CSS-Farbvariablen verändern die bisherige Standarddarstellung nicht.

Der Editor `/admin/funnels/10000000-0000-4000-8000-000000000001/editor` wurde bei 1440 × 1000 Pixeln als authentifizierter Administrator gerendert. Die optionale Überzeile ist auf der ausgewählten Startseite sichtbar und enthält den Hinweis, dass ein leeres Feld den Bereich ausblendet. Die Live-Vorschau bleibt vollständig im vorhandenen Geräte-Rahmen nutzbar.

## Interaktive Editor-Prüfung

Der authentifizierte Editor lädt die bestehende Konfiguration ohne Fehler. Der Reiter **Global** zeigt eine klar abgegrenzte Sektion **Logo & Browser-Icon** mit Favicon-Vorschau, URL-Feld, PNG/ICO-Upload und Dateihinweisen. Darunter erscheinen die beiden Grundfarben und fünf getrennte Einstellungen für normalen Antwortkasten, normalen Text, ausgewählten Hintergrund, ausgewählten Text und Auswahlrahmen. Alle vorhandenen Standardwerte werden korrekt normalisiert und angezeigt.

Die Auswahlseite **Arbeitsbereich** zeigt den normalisierten Eyebrow-Text **Kurze Frage**. Ihre vier Symbolkacheln nutzen die konfigurierten normalen Antwortfarben. Nach Klick auf **Vertrieb** wechselt genau diese Kachel sichtbar in den ausgewählten Hintergrund-, Text- und Rahmenzustand; Kontrollmarkierung und aktivierter Weiter-Button erscheinen erwartungsgemäß. Die Live-Vorschau ist damit nicht nur optisch, sondern auch für die Farbkontrolle interaktiv nutzbar.

Das Feld **Überzeile (optional)** wurde auf der Auswahlseite vollständig geleert. Die Live-Vorschau entfernte **Kurze Frage** unmittelbar und ließ weder Ersatztext noch unnötigen Leerraum zurück. Der bestehende Wert wird anschließend wiederhergestellt; die Prüfung verändert dadurch keine gespeicherte Produktionskonfiguration.

## Finaler Regressionsnachweis

Der abschließende Release-Lauf bestand die TypeScript-Prüfung, alle **33 Vitest-Tests in zehn Testdateien** und den Produktions-Build. Darin enthalten sind der erfolgreiche PNG-Upload mit isoliertem Speicher-Mock, die persistierte öffentliche Favicon-URL sowie das Setzen und Wiederherstellen von Browser-Titel und Favicon beim Routenwechsel. Die aktuellen Browser- und Netzwerkprotokolle enthalten seit Beginn der Branding-Änderung keine React-, tRPC-, Upload- oder HTTP-Fehler. Der Build meldet ausschließlich den bereits bekannten Hinweis zur Größe des gemeinsamen Client-Bundles; er verhindert die Bereitstellung nicht.
