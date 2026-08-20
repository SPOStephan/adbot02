# Meta Ad Library Collector (Plan, später)

Interner Plan — **kein Kundenfeature**. Ziel: Inspiration Vault befüllen, ohne AdBots produktive Meta-App zu belasten.

**Status:** nur Spezifikation. Umsetzung erst nach der nächsten aktiven Meta-Funktion.

## Warum getrennt von AdBot?

| | AdBot (Produkt) | Ad Library Collector |
|---|---|---|
| Meta-App / Token | Kunden-Accounts, Ads, Insights | eigene App, eigener Token |
| Rate Limits | produktkritisch | isoliert |
| Sichtbarkeit | Kunden-UI | nur intern / Site-Admin |
| Risiko bei Flags/Limits | soll unberührt bleiben | nur Collector betroffen |

AdBot importiert **nur freigegebene Ergebnisse** — nie direkt die Ad Library API.

## Architektur (3 Schritte)

```
Meta Ad Library API
        │
        ▼
┌─────────────────────┐
│  Collector (extern) │  eigene Meta-App, Cron, Rate-Limit-Throttle
│  Staging-Store      │  Rohdaten + geladene Media-Bytes
└─────────┬───────────┘
          │ freigegebene Packete
          ▼
┌─────────────────────┐
│  AdBot Import       │  service-role / Admin-only
│  Inspiration Vault  │  library_scope=INSPIRATION, asset_role=STYLE_REFERENCE
└─────────────────────┘
```

### 1) Collector (außerhalb von AdBot)

- Eigene Meta-App mit Ad-Library-API-Zugang
- Suche nach Suchbegriffen / Branchen / Ländern / aktiven Ads
- Throttling: bewusst langsam (Queue, Delay, Tagesbudget)
- Speichert:
  - Meta Ad Library ID / Page / Zeitraum
  - Text / CTA falls vorhanden
  - Media-URL → lokal/staging heruntergeladen
  - Roh-JSON für Audit
- Optional: manuelle Freigabe-Liste („diese Ads sind ok für Vault“)

### 2) Staging

- Einfacher Store (DB + Objekt-Storage reicht)
- Status: `fetched` → `reviewed` → `ready_for_import` → `imported`
- Deduplizierung über Library-ID / Content-Hash

### 3) AdBot-Import

- Admin-only Endpoint oder Job (kein Kunden-UI)
- Nutzt bestehende Inspiration-Vault-Pipeline (`register_inspiration_vault_asset`)
- Setzt Metadata z. B.:
  - `source_kind: meta_ad_library`
  - `ad_library_id`
  - `collector_batch_id`
- Ergebnis: Vault-Zeilen als Style-Refs für Creative Generation (wie heute manuelle Uploads)

## Was AdBot bewusst nicht tut

- Keinen Ad-Library-Call mit dem Kunden-/Produkt-Token
- Keine Anzeige der fremden Ads in der Kunden-Media-Library
- Keinen Launch mit importierten Library-Creatives (nur `INSPIRATION` / `STYLE_REFERENCE`)

## Offene Punkte vor Umsetzung

1. Meta App Review / benötigte Ad-Library-Permissions für den Collector
2. Suchstrategie (Keywords, Länder, Branchen, Aktualisierungsintervall)
3. Tagesbudget / Rate-Limit-Policy
4. Ob Freigabe manuell oder halbautomatisch (Filterregeln)
5. Ob Collector eigenes Mini-Repo wird oder nur ein Cron-Service

## Bezug zu Creative Generation

Phases 1–8 liefern den Korpus schon über:

- Kunden: `marked_good`, `performance_winner`
- Admin: manueller Inspiration Vault

Dieser Collector ist die **automatische Ergänzung** des Admin-Vaults — kein Ersatz für Performance-Winner aus eigenen Ads.

## Nächster Schritt (wenn dran)

1. Collector-Repo/Service anlegen (Meta-App separat)  
2. Staging-Schema + Throttle  
3. AdBot: Import-RPC/Endpoint auf bestehende Vault-Registration  
4. Kleiner Admin-Trigger „Batch importieren“  

**Jetzt:** Pause — zuerst die andere aktive Meta-Funktion bauen.
