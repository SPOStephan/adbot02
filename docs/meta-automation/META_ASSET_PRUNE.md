# Meta-Asset-Bereinigung in Adbot

Stand: 6. August 2026

## Zweck

Nach einem erfolgreichen Connect kann Meta zusätzlich „zuvor verbundene“ Assets am System User sichtbar machen. Adbot speichert dann mehr als die gewünschte Auswahl. Kunden können einzelne Assets **in Adbot** entfernen, ohne den OAuth-/Connect-Pfad zu ändern.

## Was Entfernen bewirkt

- Asset-Zeile in `meta_assets` wird gelöscht
- ID wird aus `page_ids` / `instagram_account_ids` / `ad_account_ids` entfernt
- Zugehörige Content-Kandidaten werden nicht mehr als „neu“ geführt
- Sync und Brand-Flows lesen nur noch die verbleibenden Assets → keine neuen Beiträge/Daten aus entfernten Seiten/Konten

## Was Entfernen nicht bewirkt

- Kein Meta-Widerruf
- Keine Änderung an Business Manager / Connected Apps
- Kein Eingriff in den OAuth-Callback

## Schutzregeln

- Pro Typ (Seite, Instagram, Werbekonto) muss mindestens ein Asset bleiben
- Letztes Asset eines Typs → Fehler `last_of_type` (vollständig trennen + neu verbinden, wenn Neuauswahl nötig)

## API

`POST /api/connectors/meta/assets/prune` mit `{ confirmation: "prune_meta_asset", assetId: "<meta_assets.id>" }`
