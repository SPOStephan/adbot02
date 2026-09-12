# Offizielle Meta-Quellen für Creative- und Formatoptimierung

**Stand der Quellenprüfung:** 12. September 2026
**Autor:** Manus AI

## Ads Insights API

Meta beschreibt die Ads Insights API als Quelle für Leistungsdaten auf Account-, Kampagnen-, Ad-Set- und Ad-Ebene. Der Zugriff setzt eine Meta-App sowie `ads_read` voraus. Berichte können über Parameter, Felder und Breakdowns angepasst werden. Meta weist darauf hin, dass einzelne Kennzahlen geschätzt oder in Entwicklung sein können. Adbot behandelt diese Daten deshalb nur unter expliziten Vergleichbarkeits- und Vollständigkeitsregeln als Entscheidungsgrundlage.[1]

## Breakdowns

Die offizielle Breakdown-Dokumentation nennt unter anderem `publisher_platform`, `platform_position`, `device_platform`, `impression_device` sowie Asset-Breakdowns wie `ad_format_asset`, `image_asset`, `video_asset`, `body_asset`, `title_asset` und `call_to_action_asset`.[2]

Meta beschränkt Dynamic-Creative-Asset-Breakdowns auf einen begrenzten Metriksatz. Breakdown-Kombinationen sind ebenfalls eingeschränkt. Breakdown-Werte können geschätzt sein. Off-Meta-Action-Metriken haben zusätzliche Einschränkungen. Version 1 des Adbot-Optimizers verwendet deshalb keine Dynamic-Creative- oder Placement-Breakdowns.[2]

## Ad Account Insights

Die offizielle Referenz unterstützt `level=ad`, `time_increment` und `time_range` sowie für Action-Metriken explizite `action_attribution_windows` und `action_report_time`.[3] Version 1 von Adbot verwendet ausschließlich Impressionen, Inline-Link-Klicks und Spend. Sie fordert keine Action-Metriken an und trifft damit keine automatische Entscheidung auf Basis von View-through- oder Conversion-Attribution.

## Konsequenz für Adbot

Adbot trennt Gesamt-Ad-Performance von Placement- und Asset-Breakdowns. Breakdown-Zeilen dürfen wegen ihrer höheren Kardinalität nicht in die bestehende Tagesfaktentabelle mit Schlüssel `(entity_id, date)` geschrieben werden. Autonome Entscheidungen benötigen einen versionierten, vollständigen Snapshot, eine eindeutige Creative- beziehungsweise Asset-Zuordnung, identische Währung und Ad-Set-Umgebung sowie ein vorab fixiertes Messfenster. Weil Meta die Auslieferung nicht randomisiert, beschreibt Adbot das Ergebnis als operative Traffic-Dominanz und nicht als kausalen A/B-Test.

> Bei unbekannter oder unvollständiger Evidenz erklärt Adbot keinen Gewinner und pausiert keinen vermeintlichen Verlierer.

## References

[1]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights "Meta Marketing API: Insights Overview"

[2]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights/breakdowns "Meta Marketing API: Insights Breakdowns"

[3]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account/insights "Meta Marketing API: Ad Account Insights"
