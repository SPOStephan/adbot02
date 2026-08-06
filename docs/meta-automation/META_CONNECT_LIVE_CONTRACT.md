# Meta-Connect Live-Vertrag

Stand: 6. August 2026

## Ziel

Stabiler Production-Connect über Facebook Login for Business, unabhängig vom Business-Portfolio. Keine Heuristiken, keine Altzuweisungen, kein Erfinden von Assets außerhalb der Dialogauswahl.

## Ablauf

1. **Start (`POST /api/connectors/meta/start`)**  
   Vor dem Dialog: vollständiger App-Widerruf (`DELETE /{user-id}/permissions`) + lokaler Reset. Erfolg wird im signierten OAuth-State als `authorizationReset: true` festgehalten.

2. **Callback**  
   Zwei Modi, nie gemischt:

| Modus | Bedingung | Asset-Quelle |
| --- | --- | --- |
| Granular | Mindestens eine `target_ids`-Liste nicht leer | Nur die jeweiligen `target_ids` |
| System-User nach Widerruf | Token ist System User, **alle** `target_ids` leer, `authorizationReset === true` | Token-sichtbare Assets nach frischem Widerruf: `/me/accounts`, `/me/adaccounts`, Instagram über die auf diesen Seiten verknüpften Business-Konten |

3. **Persistenz**  
   `replace_meta_connection` ersetzt Assets vollständig.

## Warum nicht `assigned_*`

Production (5.–6. August 2026) zeigte: `/{system-user-id}/assigned_pages|assigned_instagram_accounts|assigned_ad_accounts` liefern für Business-Login-System-User Graph **Code 100**, auch vollständig parameterlos (ohne `fields`/`limit`/`appsecret_proof`). Nach nachgewiesenem Vollwiderruf ist das System-User-Token bereits auf die Dialogauswahl begrenzt — `/me/*` ist dann die live-geeignete Quelle.

## Verbote

- `/me/accounts` / `/me/adaccounts` als Dialogauswahl **ohne** nachweislichen Vollwiderruf
- Instagram aus Seitenverknüpfungen im **granularen** Modus (dort nur `instagram_basic` `target_ids`)
- System-User-Direktmodus ohne nachweislichen Vollwiderruf
- Vermischen von granularen Ziel-IDs mit unfiltered `/me/*`

## Abnahme

Reconnect muss auf mindestens zwei realen Portfolios gelingen (einfach + mehrseitig, z. B. PHDL und Bon-Kredit) und genau die im Dialog gewählten Assets speichern.
