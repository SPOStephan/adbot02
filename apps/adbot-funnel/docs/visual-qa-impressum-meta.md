# Visuelle QA: Impressum, Post-Submit und Meta-Tracking

> **Historischer Hinweis:** Die in diesem Dokument geprüfte separate Meta-Einwilligungscheckbox wurde am 3. August 2026 auf ausdrücklichen Produktwunsch wieder entfernt. Der aktuelle automatische Trackingfluss und seine visuelle Prüfung stehen in [`visual-qa-meta-auto.md`](visual-qa-meta-auto.md).

Stand: 28. Juli 2026

## Öffentliche Desktopansicht (1280 × 900)

- `/f/karriere`: Der Footer zeigt **„Datenschutzerklärung“** und **„Impressum“** nebeneinander. Beide Links bleiben innerhalb des Funnel-Rahmens sichtbar; Hero, Fortschrittsanzeige und Footer überlagern sich nicht.
- `/f/karriere/impressum`: Die Impressumsseite übernimmt Branding und Seitenrahmen des Funnels, bietet einen klaren Rückweg zur Bewerbung und zeigt den Footer erneut mit Datenschutz- und Impressumslink.
- Die derzeitige Beispieldaten-Konfiguration verwendet auf der Impressumsseite noch den neutralen Hinweis, dass Anbieterangaben ergänzt werden. Vor produktiver Kampagnennutzung müssen die konkreten Anbieterangaben je Funnel im Adminbereich eingetragen werden.

Weitere Prüfpunkte: mobile öffentliche Ansicht, Kontaktseite mit optionaler Tracking-Einwilligung sowie Admin-Einstellungen für Impressum, Absendeverhalten und Meta.

## Öffentliche Mobilansicht (390 × 844)

- `/f/karriere`: Überschrift, Vertrauenselemente, CTA und Illustration brechen ohne horizontales Überlaufen um. Der Footer ordnet Vertrauenshinweis sowie **„Datenschutzerklärung“** und **„Impressum“** lesbar untereinander an.
- `/f/karriere/impressum`: Rücklink, Inhaltskarte und beide Footer-Links bleiben innerhalb des Viewports. Die Karte nutzt angemessene Innenabstände, und der Rechtstext ist auf Smartphonebreite gut lesbar.
- In beiden Ansichten wurden keine Überlagerungen oder abgeschnittenen Bedienelemente festgestellt.

Weitere Prüfpunkte: Kontaktseite mit optionaler Tracking-Einwilligung sowie Admin-Einstellungen für Impressum, Absendeverhalten und Meta.

## Adminbereich

- Die Funnel-Bibliothek lädt für den angemeldeten Administrator mit zwei veröffentlichten Kampagnen und stellt die Aktionen **„Bearbeiten“** und **„Bewerbungen“** pro Funnel klar dar.
- Der Karriere-Funnel wird über die ID `10000000-0000-4000-8000-000000000001` bearbeitet. Die Einstellungsroute wird als Nächstes direkt geprüft.
- Die Einstellungsseite lädt mit bestehenden Funnel-Daten und zeigt den neuen Impressumsbereich unmittelbar in den Grundeinstellungen. Überschrift und mehrzeiliger Inhalt sind beschriftet; der Hilfetext erklärt die sichere Textausgabe und den öffentlichen Pfad.
- Darunter sind **„Nach erfolgreicher Bewerbung“** mit Erfolgsnachricht/Weiterleitung sowie **„Meta Conversion Tracking“** mit Pixel-ID, Eventname, freiwilligem Consent-Text, verschlüsseltem Zugangstoken und optionalem Test-Event-Code als getrennte Bereiche vorhanden.
- Die Sicherheits- und Betriebszustände (Supabase-Persistenz, E-Mail-Versand) bleiben oberhalb der Formulare sichtbar. Der direkte Funnel-Link und die optionale Einbettung bleiben unverändert erreichbar.
- Die Erfolgsnachricht und Weiterleitung erscheinen als klar getrennte, verständlich erklärte Auswahlkarten. Ohne Weiterleitungsmodus wird kein URL-Feld gezeigt.
- Im gespeicherten Ausgangszustand ist **„Erfolgsnachricht“** eindeutig ausgewählt; der Weiterleitungsmodus wird nun ausschließlich lokal umgeschaltet und anschließend ohne Speichern verworfen.
- Beim lokalen Umschalten auf **„Weiterleitung“** erscheint unmittelbar das beschriftete URL-Feld mit HTTPS-Beispiel und dem Hinweis, dass ausschließlich absolute HTTPS-Adressen gespeichert werden.
- Eine absichtlich eingegebene `http://`-Adresse markiert den Formularzustand als ungültig und blockiert die Speichern-Aktion. Der Zustand wird nicht gespeichert und durch Neuladen verworfen.
- Nach dem Neuladen ist der ungespeicherte HTTP-Wert verschwunden und der gespeicherte Ausgangszustand wiederhergestellt; produktive Funnel-Daten wurden durch diese Prüfung nicht verändert.

## Finaler Qualitätslauf

- `pnpm check` ist ohne TypeScript-Fehler abgeschlossen.
- Die vollständige Vitest-Suite ist mit **18 Testdateien und 54 bestandenen Tests** abgeschlossen. Enthalten ist ein serverseitiger React-Rendering-Test, der die Meta-Einwilligung bei deaktiviertem Tracking ausblendet und bei aktiviertem Tracking als optional sowie nicht vorausgewählt absichert.
- `pnpm build` ist erfolgreich abgeschlossen. Vite weist lediglich auf einen bestehenden großen Haupt-Chunk hin; es gibt keinen Build-Fehler.
- Die aktuellen Browser-, Netzwerk- und Serverprotokolle aus dem finalen QA-Zeitraum enthalten keine neuen Laufzeit- oder Requestfehler. Ältere HMR-Fehler aus Zwischenständen sind nicht reproduzierbar und werden durch den erfolgreichen finalen Build überholt.
- Im Meta-Bereich sind Aktivierungsschalter, ausschließlich numerische Pixel-ID, Eventname und der getrennte freiwillige Consent-Text ohne Überlagerung sichtbar. Die aktuelle gespeicherte Testkonfiguration verwendet die Pixel-ID `123456789012345` und das Standardereignis `Lead`.
- Der Conversions-API-Unterbereich trennt das passwortgeschützte Tokenfeld und den optionalen Test-Event-Code optisch vom Browser-Pixel. Der Text erklärt AES-256-GCM-Speicherung, Nicht-Rückgabe des Tokens und Event-ID-Deduplizierung. Entfernen- und Speichern-Aktionen sind vorhanden und im unveränderten Zustand deaktiviert.
- Test-Event-Code, Direktlink und Einbettungscode bleiben auf der unteren Seite ohne horizontales Überlaufen erreichbar.
- Die vollständige Admin-Einstellungsseite wurde zusätzlich bei **390 × 844** geprüft. Navigation, Statuskarten, Grundfelder, Impressums-Textarea, Erfolgs-/Weiterleitungsoptionen, Meta-Schalter, Pixel-/Eventfelder, Consent-Textarea, Conversions-API-Box sowie Direktlink und Einbettungscode stapeln sich ohne horizontales Überlaufen.
- Schalter und Aktionsschaltflächen behalten auf Smartphonebreite ausreichende Abstände. Lange Hilfetexte und URLs brechen innerhalb ihrer Karten um; der Codeblock bleibt in seinem eigenen horizontalen Scrollbereich gekapselt.
- Nach der finalen Pflichtvalidierung zeigen Impressumsüberschrift und Impressumsinhalt auf **390 × 844** klar erkennbare Pflichtsternchen; Hilfetext, Eingabeflächen und Speichern-Schaltfläche bleiben ohne Überlappung oder horizontales Überlaufen bedienbar.

## Interaktiver Funnel-Durchlauf

- Der CTA **„Jetzt starten“** wechselt erwartungsgemäß von der Intro-Seite auf die erste Auswahlfrage.
- Auf der Auswahlseite sind Frage, vier Antwortkarten, Fortschrittsanzeige sowie Zurück-/Weiter-Navigation vollständig sichtbar; die Weiter-Schaltfläche bleibt bis zur Auswahl deaktiviert.
- Nach einer Auswahl wird die gewählte Karte eindeutig markiert und **„Weiter“** aktiviert. Der nächste Frageschritt lädt mit aktualisiertem Fortschritt und deaktivierter Weiter-Schaltfläche, bis erneut eine Auswahl getroffen wird.
- Der letzte Schritt zeigt das vollständige Kontaktformular mit klar markierten Pflichtfeldern, optionalem Lebenslauf-Upload und verpflichtender Datenschutz-Einwilligung. Der untere Bereich mit Tracking-Einwilligung und Absende-Navigation wird separat nach dem Scrollen geprüft.
- In der geprüften Konfiguration ist Meta-Tracking trotz hinterlegter Pixel-ID **deaktiviert**; deshalb wird die separate Tracking-Einwilligung erwartungsgemäß nicht angezeigt und der Pixel nicht geladen. Der aktivierte Zustand ist zusätzlich durch einen React-Rendering-Test abgesichert: Die Checkbox erscheint ausschließlich bei aktivem Tracking, ist optional und nicht vorausgewählt.
- Nach dem Scrollen bleiben Datenschutz-Einwilligung, Zurück-Navigation und Absende-Schaltfläche vollständig sichtbar. Es wurde keine Testbewerbung abgesendet.

Der Durchlauf wurde bis zum Kontakt- und Consent-Schritt abgeschlossen; eine echte Bewerbung wurde bei der visuellen Prüfung nicht abgesendet.
