# Meta Pixel und Conversions API – technische Arbeitsgrundlage

Stand der Prüfung: 28. Juli 2026. Die folgenden Punkte basieren ausschließlich auf der aktuellen offiziellen Meta-Dokumentation und dienen als Implementierungsgrundlage.

| Thema | Verbindliche Implementierungsgrundlage |
|---|---|
| API-Endpunkt | Server-Ereignisse werden per `POST` an `https://graph.facebook.com/{API_VERSION}/{PIXEL_ID}/events` gesendet; das Zugangstoken authentifiziert den Aufruf.[1] |
| API-Version | Die aktuelle offizielle Meta-Dokumentation weist **Graph API v25.0** als neueste Version aus; sie wurde am 18. Februar 2026 veröffentlicht.[5] |
| Website-Ereignis | `event_name`, `event_time`, `user_data` und `action_source` sind erforderlich. Für Website-Ereignisse ist zusätzlich `event_source_url` erforderlich.[1] [2] |
| Erfolgsereignis | Für eine abgeschlossene Bewerbung kann das Meta-Standardereignis `Lead` verwendet werden. Der Name muss in Browser- und Server-Ereignis identisch sein.[3] |
| Deduplizierung | Meta empfiehlt für Browser-Pixel plus Conversions API dieselbe eindeutige Kennung: Browserfeld `eventID` entspricht Serverfeld `event_id`; zusätzlich müssen Browser- und Server-Eventname übereinstimmen.[3] |
| Zeitstempel | `event_time` wird als Unix-Zeit in Sekunden und GMT übertragen; Ereignisse dürfen beim Versand höchstens sieben Tage alt sein.[2] |
| Testbetrieb | Ein im Events Manager erzeugter Code kann im Top-Level-Feld `test_event_code` übermittelt werden. Er ist ausschließlich für Tests vorgesehen und vor dem Produktivbetrieb zu entfernen.[1] |
| Fehlerentkopplung | Meta beschreibt die Conversions API als direkte Serververbindung. Für den Funnel wird der API-Aufruf deshalb nach erfolgreicher Bewerbungsspeicherung ausgeführt, darf aber Bewerbungserfolg und Weiterleitung nicht blockieren.[4] |

## References

[1]: https://developers.facebook.com/documentation/ads-commerce/conversions-api/using-the-api "Meta – Using the Conversions API"
[2]: https://developers.facebook.com/documentation/ads-commerce/conversions-api/parameters/server-event "Meta – Server Event Parameters"
[3]: https://developers.facebook.com/documentation/ads-commerce/conversions-api/deduplicate-pixel-and-server-events "Meta – Handling Duplicate Pixel and Conversions API Events"
[4]: https://developers.facebook.com/documentation/ads-commerce/conversions-api "Meta – Conversions API Overview"
[5]: https://developers.facebook.com/docs/graph-api/changelog/version25.0/ "Meta – Graph API v25.0 Changelog"
