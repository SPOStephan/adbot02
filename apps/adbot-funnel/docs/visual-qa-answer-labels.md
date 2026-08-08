# Visuelle QA: Interne Seitennamen in Bewerbungen

## Bewerbungsübersicht

- Die globale Route `/admin/applications` lädt im Desktop-Viewport **1280 × 900** fehlerfrei.
- Eine bestehende Bewerbung des Funnels `immo01` wird mit fünf Antworten angezeigt; Tabellenlayout, Filter und Exportaktionen bleiben unverändert bedienbar.
- Die bestehende Bewerbung wurde über die geschützte Adminnavigation geöffnet; die Detailroute lautet `/admin/applications/2bb711d8-5430-4175-b5dc-748076c0f214`.

## Ausstehende Detailprüfung

- Die reale Bestandsbewerbung lädt vollständig und zeigt die fünf internen Seitennamen **Sachkunde**, **Was ist wichtig**, **Erfahrung**, **Selbst-Beschreibung** und **Start**. Keine technische `question-*`-ID erscheint in der sichtbaren Detailansicht.
- Im Desktop-Layout bleiben Kontakt- und Antwortbereich klar getrennt; Statusauswahl, Zurücknavigation und technische Angaben funktionieren unverändert.
- Im Smartphone-Viewport **390 × 844** stapeln sich alle Antwortkarten ohne horizontales Überlaufen. Auch längere Seitennamen und Antwortwerte brechen innerhalb der Karten lesbar um.

## Automatisierte Abschlussprüfung

Die TypeScript-Prüfung, **20 Vitest-Dateien mit 58 bestandenen Tests** und der Produktionsbuild wurden erfolgreich abgeschlossen. Die gezielten Tests decken die Auflösung aktueller technischer Keys, lesbare Legacy-Schlüssel, veraltete Seitenreferenzen, Dashboard-tRPC-Ausgabe, E-Mail-HTML sowie CSV- und PDF-Exporte ab.

Die Browser-, Netzwerk- und Serverprotokolle des aktuellen QA-Zeitraums ab **28. Juli 2026, 07:45 Uhr** enthalten keine Laufzeitfehler, fehlgeschlagenen Requests oder neuen Serverfehler. Ausschließlich ältere Entwicklungsfehler vom Vortag lagen außerhalb dieses Abschlussdurchlaufs.
