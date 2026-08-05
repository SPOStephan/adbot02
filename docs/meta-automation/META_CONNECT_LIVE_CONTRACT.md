# Meta-Connect Live-Vertrag

Stand: 5. August 2026

## Ziel

Stabiler Production-Connect über Facebook Login for Business, unabhängig vom Business-Portfolio. Keine Heuristiken, keine Altzuweisungen, kein Erfinden von Assets.

## Ablauf

1. **Start (`POST /api/connectors/meta/start`)**  
   Vor dem Dialog: vollständiger App-Widerruf (`DELETE /{user-id}/permissions`) + lokaler Reset. Erfolg wird im signierten OAuth-State als `authorizationReset: true` festgehalten.

2. **Callback**  
   Zwei Modi, nie gemischt:

| Modus | Bedingung | Asset-Quelle |
| --- | --- | --- |
| Granular | Mindestens eine `target_ids`-Liste nicht leer | Nur die jeweiligen `target_ids` |
| System-User Assigned | Token ist System User, **alle** `target_ids` leer, `authorizationReset === true` | Nur `/{system-user-id}/assigned_pages`, `assigned_instagram_accounts`, `assigned_ad_accounts` — **ohne** Query-Parameter |

3. **Persistenz**  
   `replace_meta_connection` ersetzt Assets vollständig.

## Verbote

- `/me/accounts` / `/me/adaccounts` als Dialogauswahl
- Instagram aus `page.instagram_business_account`
- System-User-Assigned-Modus ohne nachweislichen Vollwiderruf
- `fields` / `limit` an den drei `assigned_*`-Edges (Graph Code 100)

## Abnahme

Reconnect muss auf mindestens zwei realen Portfolios gelingen (einfach + mehrseitig, z. B. PHDL und Bon-Kredit) und genau die im Dialog gewählten Assets speichern.
