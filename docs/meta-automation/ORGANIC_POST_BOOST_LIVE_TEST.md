# Live-Test: Beitragsabruf + automatische Bewerbung

**Ziel:** An einem verbundenen Meta-Werbekonto (EUR) prüfen, dass neue organische Beiträge erkannt und je nach Modus freigegeben oder automatisch beworben werden.

## Voraussetzungen

1. Vier Migrationen auf dem Ziel-Supabase angewendet (siehe `ORGANIC_POST_BOOST.md`)
2. App-Deploy mit diesem Branch (Staging oder Preview)
3. Meta verbunden mit mindestens `ads_management`, `ads_read`, `pages_read_engagement`, `instagram_basic`
4. Genau ein aktives EUR-Werbekonto, erfolgreicher Marketing-Sync
5. Facebook-Page (und optional gekoppeltes IG-Business-Konto) als Assets vorhanden
6. Aktive Kunden-Policy mit `allow_new_launches` und `allow_status_changes`
7. Kill-Switch bewusst gesetzt (siehe Modus unten)

## A) Beitragsabruf verifizieren

1. Dashboard öffnen → verbundenes Meta-Konto
2. Manuellen Sync auslösen **oder** auf den stündlichen Content-Cron warten
3. Erwartung: neue/aktuelle FB-/IG-Beiträge erscheinen als Content-Candidates
4. Ohne aktiven Beitrag-Push (`OFF`): keine Boost-Pläne

## B) REVIEW — einzeln freigeben

1. Kill-Switch: **FREEZE_WRITES**
2. Beitrag-Push: Modus **Einzeln freigeben**, Quelle z. B. **Nur Facebook** (oder both)
3. Tages- oder Laufzeitbudget + Laufzeit in Tagen speichern (Werbeziel bleibt Interaktionen)
4. Neuen Facebook-Seitenbeitrag veröffentlichen → Sync
5. Erwartung: Boost-Plan vorbereitet / Beitrag zur Freigabe sichtbar
6. Mit Bestätigung `BEITRAG BEWERBEN` freigeben
7. Kill-Switch auf **ALLOW** → Executor-Cron → Kampagne/Ad Set/Creative/Ad in Meta
8. In Meta Ads Manager: Objective Engagement, Creative = organischer Post

## C) AUTO — jeder neue Beitrag

1. Beitrag-Push: Modus **Vollautomatisch**
2. **Tagesbudget** + Laufzeit speichern (AUTO erzwingt DAILY)
3. Quelle wählen (`facebook` / `instagram` / `both`)
4. Kill-Switch: **ALLOW**
5. Neuen Beitrag auf der gewählten Quelle veröffentlichen → Sync
6. Erwartung: Plan `PENDING` → Executor schreibt ohne manuelle Freigabe
7. Meta: neue Kette mit Fixed Budget und Endzeit = Start + Tage

## Abbruch / Sicherheit

- Bei Unsicherheit sofort Kill-Switch **FREEZE_WRITES** oder **PAUSE_MANAGED**
- Kein zweiter Boost desselben Beitrags (Link + Idempotenz)
- Kleines Tagesbudget für den ersten Live-Lauf wählen

## Nachweis checken

| Check | Wo |
|---|---|
| Candidate erkannt | `meta_content_candidates` / Dashboard |
| Settings-Modus | `meta_boost_settings.boost_mode` |
| Plan erzeugt | `mutation_plans` (`source_rule_key = organic-boost`) |
| Link Beitrag↔Plan | `meta_organic_boost_links` |
| Executor | Execution steps SUCCEEDED + Meta Ads Manager |
