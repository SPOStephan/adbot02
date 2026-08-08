# Resend-Versanddomain bei ALL-INKL

Verifiziert am 27.07.2026 anhand der offiziellen Dokumentation von ALL-INKL und Resend.

## MX-Record für den Return-Path

Im KAS unter **Tools → DNS-Einstellungen → boncred.info bearbeiten → neuen DNS Eintrag erstellen** wird der von Resend angezeigte Return-Path-MX-Eintrag angelegt.

| KAS-Feld | Wert |
|---|---|
| Name | `send` (ergibt `send.boncred.info`) |
| Typ | `MX` |
| Prio | exakt der Resend-Wert, üblicherweise `10` |
| Data | exakt der von Resend angezeigte Zielhost; bei ALL-INKL mit abschließendem Punkt |

Der MX-Record betrifft nur `send.boncred.info`. Bestehende MX-Records, Postfächer und Weiterleitungen der Hauptdomain `boncred.info` werden nicht gelöscht oder geändert. Die generische ALL-INKL-Warnung zum Löschen vorhandener Postfächer gilt für die Umleitung des MX-Records der Hauptdomain, nicht für diese separate Return-Path-Subdomain.

Quellen: [ALL-INKL: MX-Record mit Host ändern](https://all-inkl.com/wichtig/anleitungen/kas/tools/dns-werkzeuge/mx-record-mit-host-aendern_154.html), [Resend: MX-Konflikte vermeiden](https://resend.com/docs/knowledge-base/how-do-i-avoid-conflicting-with-my-mx-records), [Resend: Domain hinzufügen](https://resend.com/docs/add-a-domain).
