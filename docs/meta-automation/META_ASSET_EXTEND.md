# Meta-Assets erweitern

Stand: 14. August 2026

## Kundenziel

Kampagnen laufen auf verbundenen Assets gut; der Kunde will weitere Facebook-
oder Instagram-Seiten bzw. Werbekonten aus demselben Portfolio in Adbot nutzen
— **ohne** bestehende Assets neu zu verbinden und ohne Marketing-Stand zu löschen.

## Weg in Adbot (additiv)

1. **Assets erweitern** (Plattformkarte) oder **Weitere Seiten oder Konten hinzufügen**
2. Meta-Dialog: nur die **zusätzlichen** Assets wählen
3. Callback speichert per `extend_meta_connection` (Union der IDs, Upsert der
   `meta_assets`) — bereits verbundene Assets bleiben
4. Kein App-Widerruf, kein `replace_meta_connection`, kein Marketing-Wipe

## Technisch

| Schritt | Verhalten |
| --- | --- |
| `POST /api/connectors/meta/start?intent=extend` | Kein `resetStoredMetaAuthorization` |
| OAuth-State | `intent=extend`, `authorizationReset=false` |
| Callback | `extend_meta_connection` statt `replace_meta_connection` |
| Marketing | `ad_account_ids`-Trigger wipe’t nicht, solange das aktive Werbekonto bleibt |

## Abgrenzung

| Aktion | Wirkung |
| --- | --- |
| Assets erweitern | Additiv, bestehende bleiben |
| Entfernen | Nur Adbot-Nutzung stoppen, Meta-Auth bleibt |
| Meta trennen + neu verbinden | Vollständiger Widerruf + Replace (nur wenn nötig) |

## Warum trotzdem Meta-Dialog

Neue Asset-Zuweisungen kann nur Meta im Login-for-Business-Dialog erteilen.
Adbot kann Portfolio-Assets ohne Dialog nicht freischalten. Der Dialog läuft
aber ohne vorherigen Widerruf.
