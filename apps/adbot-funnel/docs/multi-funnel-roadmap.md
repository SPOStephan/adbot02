# Vom Einzelfunnel zum wiederverwendbaren Funnel-Werkzeug

**Autor:** Manus AI  
**Stand:** 27. Juli 2026

## Ausgangslage

Der aktuelle Editor ist nicht auf konkrete Texte oder eine bestimmte Stellenanzeige fest verdrahtet. Seiten, Optionen, Farben, Empfänger, Datenschutz-Link, Slug und Veröffentlichungsstatus werden als `FunnelConfig` gespeichert. Auch Bewerbungen besitzen bereits `funnel_id` und `funnel_slug`. Damit sind Datenmodell und Rendering für mehrere Funnel vorbereitet.

Der gegenwärtige Admin-Ablauf verwaltet aus Gründen des schnellen Starts jedoch **einen aktiven Standardfunnel**. Ein Mehr-Funnel-Modus ist deshalb ein klar abgegrenzter Produktausbau und keine reine Konfigurationsänderung.

## Wiederverwendbare Bausteine

| Baustein | Wiederverwendung |
|---|---|
| Öffentliche Route `/f/:slug` | Bereits slug-basiert und für weitere öffentliche Funnel geeignet |
| Datenbanktabelle `funnels` | Mehrere Zeilen mit eindeutigem Slug möglich |
| Bewerbungszuordnung | Bereits über Funnel-ID und Slug getrennt |
| Visueller Editor | Seiten, Inhalte, Optionen, Branding und globale Texte konfigurationsgetrieben |
| Vorschau | Rendert beliebige gültige `FunnelConfig` ohne produktive Speicherung |
| Exporte | Können um einen Funnel-Filter erweitert werden |
| Sicherheitsheader | Einbettungs-Domains sind bereits pro Funnel konfigurierbar |

## Noch erforderliche Produktfunktionen

| Priorität | Funktion | Umsetzungsskizze |
|---|---|---|
| Muss | Funnel-Bibliothek | Karten- oder Tabellenansicht mit Name, Slug, Status, Bewerbungszahl und Änderungsdatum |
| Muss | Erstellen und Duplizieren | Leere Vorlage sowie Kopie eines bestehenden Funnels mit neuem Slug |
| Muss | Kontextbezogene Admin-Routen | `/admin/funnels/:id/editor`, `/settings` und `/applications` statt globaler Standardroute |
| Muss | Sichere Löschung/Archivierung | Archivieren bevorzugen; Löschen nur ohne Bewerbungen oder nach expliziter Bestätigung |
| Muss | Filter und Exporte | Bewerbungen, Kennzahlen, CSV und PDF je Funnel oder funnelübergreifend |
| Soll | Vorlagen | Wiederverwendbare Funnel-Templates für Rollen oder Kampagnen |
| Soll | Berechtigungen | Redakteure nur für freigegebene Funnel; Administratoren übergreifend |
| Kann | Versionierung | Entwurf, veröffentlichte Version und Rollback pro Funnel |
| Kann | Kampagnenauswertung | UTM-basierte Kennzahlen und Vergleich mehrerer Funnel |

## Empfohlene Reihenfolge

Zuerst sollte die Funnel-Bibliothek mit Erstellen, Duplizieren und kontextbezogenen Routen umgesetzt werden. Danach folgen getrennte Bewerbungsansichten und Exporte. Berechtigungen und Versionierung sollten erst ergänzt werden, wenn mehrere Redakteure beziehungsweise parallele Kampagnen tatsächlich vorgesehen sind. Dadurch bleibt der Ausbau kontrollierbar und verwendet den bestehenden Editor, statt einen zweiten Editor zu entwickeln.

## Abgrenzung

Die vorhandenen vier Seitentypen decken den aktuellen Social-Recruiting-Anwendungsfall ab. Soll das Werkzeug später beliebige Marketing-, Lead- oder Beratungsfunnel erzeugen, werden zusätzliche Seitentypen und gegebenenfalls bedingte Verzweigungen benötigt. Die bestehende diskriminierte Seitenstruktur in `shared/funnel.ts` bietet dafür einen klaren Erweiterungspunkt.
