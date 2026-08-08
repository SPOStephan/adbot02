# Mehr-Funnel-Zielarchitektur

**Autor:** Manus AI
**Stand:** 27. Juli 2026

## Zielbild

Die Anwendung verwaltet künftig beliebig viele voneinander getrennte Recruiting-Funnel. Jeder Funnel besitzt eine stabile UUID, einen öffentlich eindeutigen Slug, eine eigenständige Konfiguration, einen Lebenszyklusstatus und seine über `funnel_id` zugeordneten Bewerbungen. Die öffentliche Laufzeit bleibt slug-basiert; sämtliche Bearbeitungs- und Verwaltungsrouten verwenden dagegen die stabile Funnel-ID.

| Bereich | Verbindliche Entscheidung |
|---|---|
| Öffentliche URL | `/f/:slug`; nur Status `published` ist erreichbar |
| Admin-Bibliothek | `/admin`; Suche, Statusfilter, Kennzahlen und Aktionen für alle Funnel |
| Funnel-Editor | `/admin/funnels/:id/editor` |
| Funnel-Einstellungen | `/admin/funnels/:id/settings` |
| Funnel-Bewerbungen | `/admin/funnels/:id/applications` |
| Globale Bewerbungen | `/admin/applications`; optionaler Funnel- und Statusfilter |
| Detailansicht | `/admin/applications/:id`; Rückweg zum zugehörigen Funnel |
| Erstellen | Neue neutrale Vorlage mit neuer UUID, neuem Slug und Status `draft` |
| Duplizieren | Tiefe Kopie der Konfiguration mit neuen Funnel-, Seiten- und Options-IDs; keine Bewerbungen oder Dateien |
| Entfernen | Archivieren statt physischer Löschung; Wiederherstellung bleibt möglich |

## Domänenmodell

`FunnelConfig` erhält den Lebenszyklusstatus `draft | published | paused | archived`. Das bisherige Feld `isPublished` bleibt während der Migration als abgeleitetes Kompatibilitätsfeld erhalten und wird zentral aus dem Status gesetzt. Bestehende Datensätze ohne Status werden beim Lesen deterministisch normalisiert: `isPublished: true` wird zu `published`, andernfalls zu `draft`.

Die Admin-Bibliothek verwendet eine getrennte, kompakte `FunnelSummary`-Darstellung. Sie enthält nur ID, Slug, Titel, Status, Erstellungs- und Änderungszeitpunkt sowie aggregierte Bewerbungszahlen. Dadurch muss die Oberfläche für die Übersicht nicht sämtliche Editor-Konfigurationen dauerhaft im React-Zustand halten. Die verbindliche Standardsortierung ist `updatedAt` absteigend; zusätzlich kann die Oberfläche nach Titel, Erstellungszeitpunkt, Status oder Bewerbungszahl sortieren. Eine manuelle, persistierte Reihenfolge ist nicht vorgesehen, weil Funnel unabhängige Arbeitsobjekte und keine geordnete Präsentationsliste sind.

> **Invariante:** Ein archivierter oder pausierter Funnel ist öffentlich nie erreichbar. Nur der Status `published` setzt `isPublished` auf `true`.

## Erstellung und Duplizierung

Die Aktion **Neue Vorlage** erzeugt eine tiefe Kopie der neutralen Standardkonfiguration. Titel und Slug sind im Dialog editierbar; der Slug wird serverseitig normalisiert und bei Kollisionen mit einem numerischen Suffix ergänzt. Der neue Funnel beginnt immer als Entwurf.

Die Aktion **Funnel kopieren** übernimmt Seiten, Inhalte, Branding, Benachrichtigungseinstellungen, Datenschutz- und Einbettungswerte. Funnel-ID, Seiten-IDs, Options-IDs und technische Frageschlüssel werden vollständig neu erzeugt. Bewerbungen, Lebenslauf-Metadaten, UTM-Werte und Statushistorien werden ausdrücklich nicht kopiert.

## Persistenz und Skalierung

Das produktive Supabase-Schema unterstützt bereits mehrere Funnel: `funnels.slug` ist eindeutig und `applications.funnel_id` referenziert `funnels.id`. Für den ersten Mehr-Funnel-Ausbau ist deshalb keine riskante Tabellenänderung erforderlich. Der Lebenszyklusstatus liegt versioniert im vorhandenen `config`-JSON und wird zusätzlich konsistent in `is_published` gespiegelt.

Listenabfragen werden serverseitig in festen Seiten von höchstens 1.000 Datensätzen gelesen und vollständig paginiert. Damit setzt die Anwendung keine fachliche Obergrenze für die Anzahl der Funnel oder Bewerbungen, auch wenn die Benutzeroberfläche zunächst clientseitig sucht und filtert.

## Bestandsmigration

Der bestehende Produktionsfunnel behält UUID, Slug `karriere`, öffentliche URL und Bewerbungszuordnungen. Beim ersten Lesen beziehungsweise Speichern wird ausschließlich der fehlende Status ergänzt; Seiten, Texte, Branding und Bewerbungen bleiben unverändert. Die bisherige Root-Weiterleitung auf `/f/karriere` bleibt aus Kompatibilitätsgründen bestehen.

Alte Admin-URLs werden nicht mehr als primäre Navigation verwendet. Sie leiten auf die Funnel-Bibliothek beziehungsweise die globalen Bewerbungen weiter, sodass gespeicherte Browser-Lesezeichen nicht in einer Fehlerseite enden.

## Sicherheits- und Berechtigungsgrenzen

Alle Mehr-Funnel-Mutationen bleiben geschützte tRPC-Prozeduren. Der Server akzeptiert keine vom Client behaupteten Statusableitungen, sondern normalisiert Status, Slug und Kompatibilitätsfelder selbst. Öffentliche Abfragen verwenden ausschließlich den Slug und liefern weder Benachrichtigungsadresse noch erlaubte Einbettungsursprünge aus. Archivierung ist reversibel; eine physische Funnel-Löschung ist nicht Teil dieses Ausbaus.

## Nicht Bestandteil dieses Ausbaus

Mandantenfähige Rollen pro Funnel, Versionshistorien mit Rollback, bedingte Verzweigungen zwischen Seiten und zusätzliche Marketing-Funnel-Seitentypen bleiben spätere Erweiterungen. Das Daten- und Routingmodell hält dafür stabile Erweiterungspunkte bereit, ohne den aktuellen Recruiting-Ablauf zu verkomplizieren.
