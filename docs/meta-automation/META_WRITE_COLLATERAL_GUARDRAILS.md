# Meta-Write Guardrails — keine Kollateralschäden an fertigen Bausteinen

Ziel: Traffic/Lead und neue Funktionen ausbauen, **ohne** Beitrag-Push und andere schon laufende Write-Pfade zu zerlegen.

Vorfall 2026-08-11 (Kurzform): Traffic-Prepare setzte ACCOUNT-FREEZE; darunter entstandene Beitrag-Push-Pläne bekamen PLAN-FREEZE („Aktiv-Launch wartet…“). UI zeigte ALLOW, Executor soft-skipte. Aktive Meta-Boosts liefen weiter — nur neue lokale Queue hing.

## Invarianten (müssen immer gelten)

Wenn Beitrag-Push = **AUTO** und Account-Schreiben = **ALLOW**:

1. Neue organic Pläne dürfen **kein** dauerhaftes PLAN-FREEZE „Aktiv-Launch wartet auf exakte Kundenbestätigung“ bekommen.
2. Wire-freie organic Queue (`PENDING`/`RETRYABLE`, kein `remote_object_bindings`) muss **claimbar** sein (`effective_mode = ALLOW`).
3. Traffic/Lead-Prepare darf ACCOUNT nur **transient** freezen und muss Freigeben danach wiederherstellen, wenn AUTO aktiv war.
4. Canary-Sperren gehören auf **PLAN** des Canarys — nicht als Dauerzustand auf ACCOUNT.
5. Aktuelle AUTO-Settings schlagen veraltete Plan-Flags (`require_manual_approval` im Payload).

## Soft-Baseline (Content)

Beim **ersten** Abruf eines neu verbundenen FB/IG-Assets:

- Beiträge mit `published_at` **vor** Asset-Connect → Bestand (`is_new=false`)
- Beiträge mit `published_at` **ab** Connect (−6h Grace) → `is_new=true`

Sonst werden frische Posts beim Extend fälschlich als Bestand begraben.

Smoke: nach Asset-Extend + neuem Post → Kandidat `is_new=true` ohne zweiten Abruf-Zyklus nötig.

## Hochrisiko-Dateien / Themen

Jede Änderung hier ist Kollateral-Risiko — eng, additiv, mit Smoke danach:

- `kill_switch_state` / `get_effective_meta_kill_switch` / `set_meta_customer_kill_switch`
- `ensureFreezeWritesForLaunch` / Launch-Prepare/Approve
- `mutation_plans` INSERT-Trigger (Canary-Gate / PLAN-FREEZE)
- `materialize_meta_organic_boost_plan` / organic planner
- `meta_organic_boost_executor_preflight_ok` / claim kill-gate
- `prepare_meta_organic_boost_write_now` / queue sync / heal-Funktionen
- Refreeze nach LAUNCH_CHAIN-Terminals

## Pflicht-Checkliste vor Merge (Traffic / Kill-Switch / Launch / organic)

- [ ] Ändert der PR einen der Hochrisiko-Pfade? Wenn ja: Invarianten oben explizit gegenlesen.
- [ ] Prepare lässt ACCOUNT danach wieder ALLOW, wenn Beitrag-Push AUTO (oder vorher ALLOW war)?
- [ ] Kein neues „bake“ von transientem FREEZE in immutable Plan-Payload / PLAN-Kill für organic AUTO.
- [ ] SQL-Migration in Supabase angewendet (App-Deploy allein reicht nicht).
- [ ] **Smoke-SQL** unten grün (oder Abweichung verstanden und behoben).
- [ ] Manuell: nach Traffic-Prepare einmal Dashboard — steckende Beitrag-Push-Zeilen ohne Meta-Kontakt? Wenn ja: Query C / Smoke, nicht „Meta kaputt“.

## Nach jedem relevanten SQL-Apply

1. Migration raw ausführen.
2. Smoke-SQL ausführen: `supabase/diagnostics/meta_write_smoke_organic_after_traffic.sql`
3. Erwartet: keine Zeile in Abschnitt „FAILING“; Account effective ALLOW wenn Freigeben aktiv.

## Was Agents / Entwickler nicht tun sollen

- Symptom-Heals für einzelne Plan-IDs als „Lösung“ verkaufen — Ursache in shared gates beheben.
- ACCOUNT dauerhaft freezen „für Canary-Sicherheit“, während Beitrag-Push AUTO laufen soll.
- UI-Text ändern und annehmen, der Executor sei geheilt (ohne SQL + effective kill prüfen).
- Aktive Meta-Kampagnen / `REMOTE_APPLIED` Pläne „mitreparieren“.
