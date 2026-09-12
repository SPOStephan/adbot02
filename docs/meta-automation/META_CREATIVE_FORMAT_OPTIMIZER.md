# Autonome Meta-Creative- und Formatoptimierung

**Stand:** 12. September 2026
**Autor:** Manus AI

## Ergebnis und fachliche Grenze

Adbot betreibt für geeignete, von Adbot verwaltete Meta-Ad-Sets einen autonomen Creative-Regelkreis. Er startet im **bestehenden Ad Set** genau eine zusätzliche Einzelbildanzeige, beobachtet ein vorab fixiertes Messfenster und pausiert einen operativ klar unterlegenen Testarm nur unter konservativen Evidenz- und Sicherheitsbedingungen. Er erstellt weder Kampagnen noch Ad Sets und verändert kein Budget.

Version 1 ist bewusst auf Kampagnen mit Ziel **Traffic** und Ad-Set-Optimierungsziel `LINK_CLICKS` begrenzt. Grundlage sind Impressionen, Inline-Link-Klicks und Spend auf Ad-/Tagesebene. Lead-, Sales- und View-through-Conversions werden nicht zur automatischen Creative-Entscheidung verwendet. Meta randomisiert die Auslieferung zwischen Ads nicht; deshalb bezeichnet Adbot das Ergebnis ausdrücklich als **operative Traffic-Dominanz**, nicht als kausal bewiesenen Creative-Effekt oder statistisch randomisierten A/B-Test.[1]

## Autonomer Regelkreis

| Phase | Verhalten | Harte Schranke |
| --- | --- | --- |
| Kandidatenauswahl | Adbot verwendet nur freigegebene eigene Uploads oder freigegebene generierte Assets desselben aktiven Brand-Profils. | Keine fremden Assets, keine Moderations- oder Review-Umgehung, keine Style-Referenzen, kein bereits getesteter Inhalt oder Hash. |
| Teststart | Bei genau einer aktiven, verwalteten Anzeige wird eine zweite Anzeige im selben Ad Set angelegt. Text, Zielseite, Tracking und übrige Creative-Felder stammen aus einem erfolgreich reconcilierten Adbot-Launch. Nur Bild beziehungsweise Format wird ersetzt. | Nur Traffic/`LINK_CLICKS`; Kampagne und Ad Set aktiv und verwaltet; `allow_new_launches` und `allow_status_changes` aktiv; Kill-Switch `ALLOW`. |
| Messfenster | Nach bestätigter Aktivierung wird einmalig das nächste volle lokale Sieben-Tage-Fenster gespeichert. Die jüngsten drei Kontotage bleiben von Entscheidungen ausgeschlossen. | Fensterstart und -ende sind für einen aktiven Zyklus unveränderlich. Keine gleitende Fenstersuche und kein wiederholtes Peeking nach einem Gewinner. |
| Daten | Ein separater vollständiger Meta-Insights-Abruf liest `level=ad`, `time_increment=1`, Impressionen, Inline-Link-Klicks und Spend. | Exakte Ad-Account-ID, aktuelle Snapshot-ID, feste Ad-Paarung und genau sieben kanonische Tageswerte. Unparsbare oder partielle Zeilen blockieren die Entscheidung. |
| Mindestvolumen | Jeder Testarm benötigt mindestens 1.000 Impressionen, 50 EUR Spend und 100 Inline-Link-Klicks. | Fehlendes Volumen beendet das einmalige Fenster ohne Gewinner und ohne Pause. |
| Vergleichbarkeit | Das Verhältnis des kleineren zum größeren Gesamtvolumen muss bei Impressionen und Spend jeweils mindestens 0,5 betragen. | Stärker ausgelieferter Arm darf nur gewinnen, wenn er zugleich mindestens so viele Impressionen und mindestens so viel Spend erhalten hat. |
| Operativer Gewinner | Der bessere Link-CTR-Arm benötigt mindestens zehn Prozent relativen Vorsprung und muss an mindestens sechs von sieben Tagen die höhere Link-CTR aufweisen. | TypeScript und SQL rekonstruieren Summen, Tagesgewinne, Rate und Lift unabhängig aus den sieben Rohzeilen. Kein p-Wert und keine Kausalitätsbehauptung. |
| Pause | Nur der operativ unterlegene, verwaltete Testarm wird pausiert. | Exakt zwei aktive Ads, Organic Boost ausgeschlossen, Kundenrecht aktiv, Snapshot und Evidenz höchstens zehn Minuten alt, Kampagne/Ad Set/Budgets/Ad-Anzahl unmittelbar vor dem Write frisch über Meta geprüft. |
| Kompensation | Wenn nach Anlage oder Aktivierung der Test-Ad ein späterer Saga-Schritt scheitert, versucht der Executor die gebundene Test-Ad sofort zu pausieren und liest den Pausenstatus zurück. | Misslingt Pause oder Readback, bleibt der Vorgang mit unbekanntem Remotezustand in Reconciliation statt still terminal zu scheitern. |
| Wiederholung | Nach einem abgeschlossenen Zyklus darf ein noch nicht getesteter Asset-Inhalt in einem neuen Zyklus antreten. | Zwölf Stunden Cooldown, höchstens ein offener Zyklus je Ad Set; beide Arme eines früheren Tests sind als bereits geprüft markiert. |

## Datenwahrheit

Ein Meta-Insights-Response wird nur vollständig akzeptiert. Unparsbare oder scope-inkonsistente Zeilen führen zum Fehler des gesamten Abrufs. Alle lokalen Supabase-Reads vergleichen außerdem die exakte Zeilenanzahl mit der gelieferten Datenmenge; eine PostgREST-Begrenzung blockiert den Lauf, statt Objekte still zu übersehen. Für das feste Fenster nicht zurückgegebene Ad-/Tageszeilen gelten als explizite Nullauslieferung; eine vorhandene Zeile mit fehlenden Kennzahlen bleibt dagegen unvollständig und blockiert. Geldwerte werden ohne Gleitkomma-Rundung centgenau geparst.

Der SQL-Materializer vertraut keinem zusammengefassten Gewinnerobjekt allein. Er verlangt die sieben Tageszeilen beider Arme, rekonstruiert alle Summen und Tagesgewinne, bindet die Evidence exakt an den aktiven Zyklus, dessen erfolgreich reconcilierten Testplan, den verifizierten Root-Launch, das Meta-Werbekonto und den aktuellen Marketing-Snapshot. Die servervalidierte Roh-Evidence und ihr Hash werden bei Winner wie No-Winner unveränderlich am Zyklus gespeichert; ein No-Winner erzeugt zusätzlich ein append-only Audit-Event. Ein vollständiges Fenster ohne operative Dominanz – einschließlich eines vollständig nicht ausgelieferten Arms – wird genau einmal als `COMPLETED` abgeschlossen; spätere Datenänderungen öffnen es nicht erneut.

## Mutation und Isolation

Die Test-Saga nutzt die bestehende unveränderliche Meta-Control-Plane. Sie darf nur Bild-Upload, Creative-Erstellung, pausierte Ad-Erstellung, Aktivierung, Readbacks, Reconciliation und eine evidenzbasierte Ad-Pause enthalten. `CREATE_CAMPAIGN`, `CREATE_AD_SET` und `UPDATE_BUDGET` sind ausgeschlossen.

Unmittelbar vor mutierenden Schritten liest der Executor Kampagne, Ad Set und alle Ads dieses Ad Sets frisch aus Meta. Der Write wird blockiert, wenn Werbekonto, Snapshot, Parentbeziehung, Parentstatus, Budgets, Baseline-/Shadowstatus oder aktive Ad-Anzahl abweichen. Eine weitere Meta-Paging-Seite blockiert ebenfalls, statt eine unvollständige Anzahl zu verwenden.

## Kundenkontrolle und Sichtbarkeit

Ein neuer Test startet nur bei erlaubten neuen Launches und Statusänderungen. Ein bereits laufender Test darf bei weiterhin erlaubten Statusänderungen sauber enden, auch wenn neue Launches inzwischen deaktiviert wurden. Die bisherige automatische Geschwister-Pause ohne Mindestvolumen wird durch die Migration deaktiviert; beide Legacy-RPCs sind service-role-only und wirkungslos.

Das Kampagnen-Dashboard zeigt geplante, aktive, abgeschlossene und abgebrochene Zyklen einschließlich des festen Messfensters. Eine fehlende Cycle-Abfrage wird fehlertolerant als leere Liste behandelt, damit bestehende Meta-Verbindungen und Kampagnendaten nicht ausfallen.

## Rollout

Die Datenbankmigration muss **vor** dem Anwendungscode in Supabase ausgeführt werden. Sie wird nicht automatisch von Vercel angewendet. Nach der einmaligen Ausführung im Supabase SQL Editor werden Fresh-Postgres-Regression, ACL-/Funktionsprüfungen, Merge, Produktionsdeployment und read-only Live-Checks durchgeführt.

## Nicht enthalten

Version 1 optimiert nur klassische Einzelbild-Creatives in geeigneten Meta-Traffic-Ad-Sets. Videos, Carousels, Dynamic-Creative-Kombinationen, Placement-/Asset-Breakdowns, Lead-/Sales-Ziele, fremd angelegte nicht verifizierte Kampagnen und andere Plattformen benötigen jeweils einen separaten normalisierten Mess- und Ausführungsvertrag.

## References

[1]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights "Meta Marketing API: Insights Overview"

[2]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights/breakdowns "Meta Marketing API: Insights Breakdowns"

[3]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account/insights "Meta Marketing API: Ad Account Insights"
