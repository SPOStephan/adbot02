# Erster Live-Test: Funnel, Pixel und Leads

Einfache Schritte für dich und für Kundinnen und Kunden. Ziel: Eine echte Bewerbung kommt als Conversion bei Meta an. Danach kannst du gute und schlechte Leads bewerten, damit Meta mehr von den guten findet.

## 1. Meta Pixel in Adbot verbinden

1. In der Meta Business Suite den Events Manager öffnen und die numerische Pixel-ID kopieren.
2. In Adbot unter **Tracking** die ID einfügen und **Pixel bestätigen**.
3. Das Conversion-Event bleibt im Regelfall `LEAD`.

Funnel und Freebie übernehmen die ID automatisch, wenn dort noch keine andere steht.

## 2. Meta-Tracking im Funnel einschalten

1. Funnel öffnen → gewünschter Funnel → **Einstellungen** → **Meta Conversion Tracking**.
2. **Meta-Tracking aktiv** einschalten. Pixel-ID kommt meist schon aus dem Portal.
3. Eventname: `Lead`. Zeitpunkt: **Beim Absenden**.
4. Empfohlen: Conversions-API-Zugangstoken aus dem Events Manager hinterlegen.

Ohne Token arbeitet der Funnel nur mit dem Browser-Pixel. Adblocker können Events schlucken. Gut/Schlecht-Bewertungen können dann nicht serverseitig an Meta gehen.

## 3. Domain anlegen und bestätigen

1. Unter **Domains** eine eigene HTTPS-Domain anlegen oder sie im Funnel hinterlegen.
2. Nur den CNAME beim Domain-Anbieter setzen. SSL und Hosting legt Adbot an.
3. DNS prüfen, bis der Status **READY** ist.
4. Dieselbe Domain nicht gleichzeitig an Funnel und Freebie binden.

## 4. Lead-Canary starten

1. Unter **Traffic-Launch** den Lead-Canary wählen — nicht den Traffic-Canary und nicht Beitrag-Push.
2. Voraussetzungen: Meta verbunden, Policy und Freigeben aktiv, Pixel bestätigt, READY-Domain als Ziel-URL.
3. Kleines Tagesbudget. Destination ist der veröffentlichte Funnel.

## 5. Testbewerbung prüfen

1. Optional im Funnel einen Test-Event-Code aus dem Events Manager eintragen.
2. Eine eindeutig als Test markierte Bewerbung absenden.
3. Im Events Manager unter Test Events muss `Lead` erscheinen. Mit Token siehst du Browser- und Serversignal zur selben Event-ID.
4. Testcode danach leeren. Testdatensatz fachlich kontrollieren und entfernen.

## 6. Gute und schlechte Leads bewerten

Zwei Signale, die sich ergänzen:

### Manuell: Gut oder Schlecht

In der Funnel-Bewerbungsübersicht eine Einsendung öffnen und **Gut** oder **Schlecht** wählen.

- **Gut** sendet an Meta das Standardereignis `Subscribe` mit einem Wert (Standard 100 € oder der Antwort-Wert).
- **Schlecht** sendet das benutzerdefinierte Ereignis `DisqualifiedLead` mit niedrigem Wert (Standard 0 €).

Meta kann anschließend auf `Subscribe` oder auf Wert optimieren. Die laufende Lead-Kampagne stellt das nicht automatisch um.

### Automatisch: Wert je Antwort

Im Funnel-Editor kannst du zentralen Antwortoptionen einen Euro-Wert geben — zum Beispiel mehr Berufserfahrung = höherer Wert. Die Summe der gewählten Antworten geht schon beim Absenden mit dem Lead an Meta (`custom_data.value` + `currency: EUR`).

So bekommt Meta sofort ein Qualitätsgefälle, noch bevor jemand manuell bewertet.

## Was Meta damit macht — und was nicht

| Signal | Wann | Was Meta sieht | Wofür es dient |
|---|---|---|---|
| Lead | Bewerbung gespeichert | Conversion, optional mit Wert | Kampagne findet mehr Bewerbungen |
| Subscribe | Du bewertest **Gut** | Qualifizierter Lead mit Wert | Später auf bessere Leads optimieren |
| DisqualifiedLead | Du bewertest **Schlecht** | Niedriger Wert, kein Optimierungsziel | Reporting; nicht als Kampagnenziel wählen |
| Antwort-Wert | Schon beim Absenden | Höherer oder niedrigerer `value` | Wert-Optimierung und Lookalikes |

Wichtig: Eine nachträgliche Schlecht-Bewertung löscht den ursprünglichen Lead nicht. Meta lernt vor allem über die **guten** Folgesignale. Deshalb regelmäßig Gut markieren, sobald eine Bewerbung fachlich passt.

Das Conversions-API-Token ist dafür Pflicht. Ohne Token bleibt die Bewertung in Adbot gespeichert, geht aber nicht an Meta.
