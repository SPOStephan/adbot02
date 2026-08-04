# Organic Post Boost (Beitrag-Push)

**Stand:** 4. August 2026  
**Scope:** Meta Facebook page posts (Phase 1)

## Kundenmodi

| Modus | Verhalten |
|---|---|
| `OFF` | Beiträge werden erkannt, aber nicht beworben |
| `REVIEW` | Neue Beiträge werden automatisch als Boost-Plan vorbereitet; Kunde gibt jeden Beitrag einzeln frei (`BEITRAG BEWERBEN`) |
| `AUTO` | Jeder neue Facebook-Beitrag wird mit Tagesbudget × Laufzeit automatisch beworben |

Standard-Werbeziel in beiden aktiven Modi: **Interaktionen/Likes**  
(`OUTCOME_ENGAGEMENT` / Optimierung `POST_ENGAGEMENT`).

`AUTO` verlangt bewusst ein **Tagesbudget** plus **Laufzeit in Tagen** (Start/Ende am Ad Set).

## Multi-Tenant

Alle Tabellen/RPCs sind an `(user_id, platform_account_id)` gebunden. Neue Konten erhalten dieselben Modi isoliert.

## Live-Test (verbundenes Werbekonto)

1. Drei Migrationen anwenden:
   - `20260803180000_meta_organic_post_boost.sql`
   - `20260803180100_meta_organic_boost_materializer.sql`
   - `20260804090000_meta_boost_mode_selection.sql`
2. Deploy des PR-Branches / Merge nach Staging oder Preview
3. Meta mit `ads_management`, EUR-Konto, erfolgreicher Sync
4. Policy aktiv mit `allow_new_launches`
5. Beitrag-Push-Modus wählen:
   - **REVIEW:** Kill-Switch `FREEZE_WRITES` → Sync → Freigabe im Dashboard
   - **AUTO:** Tagesbudget + Tage speichern → Kill-Switch `ALLOW` → Sync → Executor schreibt
6. Neuen Facebook-Seitenbeitrag veröffentlichen oder manuellen Sync auslösen

## Grenzen Phase 1

- Instagram wird erkannt, Auto-Boost läuft über Facebook-`object_story_id`
- Optionaler CTA kann von Meta je Posttyp per `validate_only` abgelehnt werden
