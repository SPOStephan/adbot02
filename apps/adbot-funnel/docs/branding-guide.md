# Branding je Funnel verwalten

Die Branding-Einstellungen werden im Admin-Dashboard pro Funnel gepflegt. Öffnen Sie `/admin`, wählen Sie den gewünschten Funnel und anschließend **Bearbeiten**. Der Reiter **Global** enthält die funnelweiten Einstellungen; der Reiter **Seite** enthält die Inhalte der aktuell ausgewählten Seite.

| Aufgabe | Bedienweg | Wirkung |
|---|---|---|
| Favicon festlegen | **Global → Logo & Browser-Icon → Favicon-URL** oder **PNG/ICO hochladen** | Gilt ausschließlich für den geöffneten Funnel und erscheint auf dessen öffentlicher URL im Browser-Tab. |
| Normale Antwortkästen gestalten | **Global → Klickbare Antwortkästen → Kasten / Kasten-Text** | Legt Hintergrund und Textfarbe aller noch nicht ausgewählten Antworten fest. |
| Ausgewählte Antwort gestalten | **Global → Klickbare Antwortkästen → Auswahl / Auswahl-Text / Auswahl-Rahmen** | Legt den aktiven Zustand nach einem Klick fest. Dieser Zustand kann direkt in der Live-Vorschau geprüft werden. |
| „Kurze Frage“ ändern | Gewünschte Seite wählen → **Seite → Überzeile (optional)** | Der eingegebene Text erscheint oberhalb der Überschrift. Ein vollständig leeres Feld blendet den Bereich ohne Ersatztext aus. |

Für Favicons werden PNG- und ICO-Dateien bis 512 KiB unterstützt. Quadratische Dateien mit 32 × 32 oder 48 × 48 Pixeln eignen sich besonders gut. Ein hochgeladenes Favicon wird im Dateispeicher abgelegt; im Funnel wird nur die erzeugte URL gespeichert. Änderungen werden erst nach Klick auf **Speichern** dauerhaft übernommen.

## Technische Referenzen

Die Konfigurationsfelder und ihre Standardwerte sind im gemeinsamen Funnel-Modell dokumentiert.[1] Der Editor bindet dieselben Felder an die Live-Vorschau an.[2] Die öffentliche Funnel-Seite setzt das jeweils funnelbezogene Favicon beim Laden und stellt das vorherige Browser-Icon beim Verlassen wieder her.[3]

## References

[1]: ../shared/funnel.ts "Gemeinsames Funnel-Konfigurationsmodell"
[2]: ../client/src/pages/admin/FunnelEditor.tsx "Admin-Editor für Funnel-Inhalte und Branding"
[3]: ../client/src/pages/Funnel.tsx "Öffentliche Funnel-Runtime"
