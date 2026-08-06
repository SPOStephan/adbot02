# Meta-Assets erweitern

Stand: 6. August 2026

## Kundenziel

Kampagnen laufen auf verbundenen Assets gut; der Kunde will weitere Facebook- oder Instagram-Seiten bzw. Werbekonten aus demselben Portfolio in Adbot nutzen.

## Weg in Adbot

1. **Assets erweitern** (Plattformkarte) oder **Weitere Seiten oder Konten hinzufügen** (Asset-Liste)
2. Meta-Dialog: **alle** gewünschten Assets wählen — bestehende **und** neue
3. Nach dem Callback speichert Adbot die von Meta gelieferte Menge
4. Überzählige „zuvor verbundene“ Assets bei Bedarf mit **Entfernen** bereinigen

## Warum erneut der Meta-Dialog

Neue Asset-Zuweisungen kann nur Meta im Login-for-Business-Dialog erteilen. Adbot kann Portfolio-Assets nicht selbst freischalten. Der technische Start ist derselbe Endpunkt wie beim Connect (`POST /api/connectors/meta/start`); OAuth-Callback und Asset-Ermittlung bleiben unverändert.

## Abgrenzung

| Aktion | Wirkung |
| --- | --- |
| Assets erweitern | Neuer Meta-Dialog, Auswahl ersetzen/erweitern laut Meta |
| Entfernen | Nur Adbot-Nutzung stoppen, Meta-Autorisierung bleibt |
| Meta trennen | Vollständiger Widerruf + lokale Asset-Leere |
