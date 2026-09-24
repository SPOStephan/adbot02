# Adbot-Adapter für den waizr Credit-Service

**Stand:** 24. September 2026
**Autor:** Manus AI

## Ergebnis

Adbot nutzt eine stabile Credit-Fassade, hinter der entweder das bisherige lokale Ledger oder der eigenständige waizr Credit-Service arbeitet. Die Fachfunktionen für Text- und Bildgenerierung rufen weiterhin dieselben Methoden auf. Der Provider wird ausschließlich serverseitig über `ADBOT_CREDIT_PROVIDER` gewählt.

Der waizr-Modus verwendet OAuth Client Credentials. Zugangsdaten bleiben in Vercel und werden weder an den Browser noch in die Adbot-Datenbank übertragen. Der kurzlebige Access Token wird im Serverprozess zwischengespeichert. Fehlgeschlagene Anfragen fallen niemals still auf das lokale Ledger zurück. Dadurch kann keine Aktion versehentlich doppelt oder in zwei unterschiedlichen Ledgers abgerechnet werden.

## Unabhängigkeit von KIready

Direkte Adbot-Kunden bleiben unabhängig von KIready. Vor einer kostenpflichtigen Aktion prüft Adbot zuerst, ob ein direktes Adbot-Abo mit aktivem Zeitraum vorliegt. Ein solcher Vertrag erlaubt die Nutzung auch dann, wenn derselbe Nutzer zusätzlich mit KIready verknüpft ist und das KIready-Recht später ausläuft.

Nur wenn kein direkter Adbot-Vertrag vorliegt, gilt für einen verknüpften Nutzer das KIready-Unternehmensrecht einschließlich der persönlichen Zuweisung `adbot:use`. Nicht verknüpfte Direktnutzer werden nicht von KIready abhängig gemacht; ihr tatsächliches Nutzungsrecht wird weiterhin durch Vertrag und verfügbares Guthaben begrenzt.

## Kontenmodell

Der zentrale Credit-Service führt organisationsbezogene Konten. Adbot ruft die Kontoanlage bei Bedarf mit einer stabilen externen Referenz und einem deterministischen Idempotenzschlüssel auf. Der Credit-Service liefert dadurch bei jedem Serverstart dasselbe Konto zurück. Adbot benötigt weder ein zweites Ledger noch eine neue lokale Mappingtabelle.

Ein Nutzer mit aktivem direkten Adbot-Vertrag wird immer seinem stabilen Direktkundenkonto zugeordnet. Eine eventuell zusätzlich vorhandene KIready-Mitgliedschaft ändert dieses Abrechnungskonto nicht. Nur Nutzer, deren Adbot-Recht ausschließlich aus KIready stammt, werden dem gemeinsamen KIready-Unternehmenskonto zugeordnet. Ein nicht verknüpfter direkter Nutzer erhält ebenfalls ein stabiles persönliches Konto. Diese Fallback-Zuordnung kann später in ein erweitertes direktes Adbot-Teammodell überführt werden, ohne das zentrale Ledger zu ersetzen.

## Verbrauchsablauf

Eine abrechenbare Aktion folgt immer diesem Ablauf:

1. Adbot ermittelt das zentrale Konto.
2. Adbot erzeugt ein zeitlich begrenztes Angebot für den konkreten Leistungscode und die benötigte Credit-Menge.
3. Adbot reserviert den Betrag idempotent.
4. Nach erfolgreicher Leistung wird die Reservation vollständig erfasst.
5. Vor einem Provideraufruf fehlgeschlagene oder endgültig abgebrochene Aktionen geben die Reservation frei.

Asynchrone Creative-Jobs speichern Provider und Reservation dauerhaft im Jobdatensatz. Ein Datenbank-Trigger stellt nach erfolgreicher Leistung eine Capture-Nachricht und nach endgültigem Abbruch eine Release-Nachricht in eine interne Settlement-Queue. Der Reconciler beansprucht jede Nachricht mit einer Lease und führt sie idempotent beim ursprünglichen Provider aus. Transiente Fehler werden mit exponentiellem Backoff bis zu zehnmal wiederholt. Deshalb bleibt die Finanzfinalität auch erhalten, wenn der Prozess nach der Asset-Speicherung abstürzt oder der Credit-Service vorübergehend nicht erreichbar ist.

## Berechtigungen des Adbot-Laufzeitclients

Der reguläre Adbot-Client benötigt nur folgende Scopes:

```text
accounts:read
accounts:write
credits:read
credits:reserve
credits:capture
credits:release
catalog:read
```

Der Laufzeitclient erhält bewusst **kein** `credits:grant`. Käufe, Abo-Gutschriften und Migrationen benötigen später einen getrennten Fulfillment-Client. So kann ein kompromittierter Webprozess kein Guthaben erzeugen.

## Serverkonfiguration

Für den waizr-Modus werden folgende Vercel-Variablen benötigt:

```text
ADBOT_CREDIT_PROVIDER=waizr
WAIZR_CREDIT_API_URL=https://credits.waizr.co
WAIZR_CREDIT_CLIENT_ID=<serverseitige Client-ID>
WAIZR_CREDIT_CLIENT_SECRET=<serverseitiges Secret>
WAIZR_CREDIT_TIMEOUT_MS=8000
```

`WAIZR_CREDIT_CLIENT_SECRET` darf ausschließlich als verschlüsselte oder sensitive Vercel-Variable hinterlegt werden. Es darf nie das Präfix `NEXT_PUBLIC_` tragen.

## Reihenfolge für den Live-Cutover

Zuerst wird die Katalogmigration im Credit-Service angewendet. Danach wird der eingeschränkte Adbot-Laufzeitclient angelegt. In der Adbot-Datenbank wird ausschließlich die additive Settlement-Outbox-Migration angewendet. Eine Konten- oder Ledger-Migration ist dort nicht erforderlich.

Vor der Umschaltung müssen offene lokale Reservationen abgeschlossen oder freigegeben werden. Vorhandene positive Wallet-Salden werden einmalig als `migration`-Grant auf die entsprechenden zentralen Konten übertragen. Erst wenn Kontrollsummen und Stichproben stimmen, wird `ADBOT_CREDIT_PROVIDER=waizr` gesetzt und neu bereitgestellt.

Nach der Umschaltung werden Saldo, eine erfolgreiche Reserve-Capture-Sequenz, eine Reserve-Release-Sequenz, Idempotenz und fehlendes Guthaben geprüft. Es gibt keine Dual-Write-Phase.

## Rollback

Der technische Rollback besteht aus genau einem Konfigurationswechsel:

```text
ADBOT_CREDIT_PROVIDER=legacy
```

Danach wird Adbot erneut bereitgestellt. Vor einem Rollback müssen bereits im zentralen Ledger reservierte Aktionen abgeschlossen oder freigegeben werden. Während eines Rollbacks werden keine automatischen Gegenbuchungen zwischen den Ledgers vorgenommen.

## Referenzen

[1]: https://credits.waizr.co "waizr Credit-Service"
[2]: https://github.com/SPOStephan/waizr-credit-service "waizr Credit-Service Repository"
[3]: https://github.com/SPOStephan/adbot02 "Adbot Repository"
