# Meta-Schreibscope und sicherer Staging-Reconnect

**Stand: 29. Juli 2026.** Dieses Dokument beschreibt den minimalen Berechtigungs- und Reconnect-Vertrag für die kontrollierte Staging-Erprobung. Es ist kein Freigabenachweis für Production und ersetzt weder Meta App Review noch Business Verification.

> **Zentrale Sicherheitsannahme:** Laut Meta greifen Marketing-API-Aufrufe auf jeder Zugriffsebene auf Produktionsdaten zu. Ein als „Staging“ bezeichnetes Deployment ist daher nur dann sicher, wenn es zusätzlich auf ausdrücklich freigegebene Test-Werbekonten, harte Kundencaps, einen initialen `FREEZE_WRITES`-Zustand und eine separate Staging-Umgebung begrenzt ist.[1]

## Verifizierter Berechtigungsvertrag

Die bestehende Verbindung verwendet Leseberechtigungen für Werbedaten sowie Seiten- und Instagram-Inhalte. Für die implementierten Kampagnen-, Ad-Set-, Creative-, Ad-, Status- und Budgetmutationen ist **`ads_management`** der engste zusätzliche OAuth-Scope. Meta beschreibt diese Berechtigung ausdrücklich für das programmgesteuerte Erstellen von Kampagnen, das Verwalten von Ads und das Abrufen von Metriken.[2]

| Berechtigung oder Feature | Staging-Verwendung | Entscheidung |
| --- | --- | --- |
| `ads_management` | Kampagnen, Ad Sets, Creatives und Ads erstellen; Budgets und Status verwalten; Read-back durchführen | **Neu erforderlich** |
| `ads_read` | Bestehender Reporting- und Insights-Pfad | **Beibehalten** |
| `pages_show_list` | Verbundene Facebook-Seite für Brand-/Creative-Actor auswählen | **Beibehalten** |
| `pages_read_engagement` | Bestehende Seiteninhalte als Brand-/Creative-Signale lesen | **Beibehalten** |
| `instagram_basic` | Bestehendes Instagram-Business-Profil und dessen Inhalte lesen | **Beibehalten** |
| `business_management` | Für den implementierten, accountgebundenen Objekt- und Actor-Pfad nicht erforderlich | **Nicht anfordern** |
| Marketing API Access Tier | Separates Rate-Limit- und Quotenfeature; seit 4. Mai 2026 mit den Stufen `Limited Access` und `Full Access` | **Vor Fremdkundenbetrieb separat prüfen/freigeben** |

Für ein eigenes Werbekonto reichen nach der offiziellen Autorisierungsdokumentation Standardzugriff und die passenden Ads-Berechtigungen aus. Soll die App Werbekonten anderer Unternehmen verwalten, benötigt sie **Advanced Access** für `ads_read` und/oder `ads_management`; Meta verlangt dafür einen individuellen App-Review-Prozess.[1] Die Permissions Reference nennt für `ads_management` unter anderem einen vollständigen Login-Screencast, die Anzeige realer Performance-Daten und konkrete Beispiele für die Verwaltung von Ads im Namen anderer Unternehmen.[2]

Davon zu unterscheiden ist das **Marketing API Access Tier**. Meta hat das frühere Feature „Ads Management Standard Access“ am 4. Mai 2026 umbenannt: Die Feature-Stufen heißen nun `Limited Access` und `Full Access`. Für die obere Stufe nennt Meta mindestens 500 Marketing-API-Aufrufe in den vergangenen 15 Tagen sowie eine Fehlerrate unter 15 % über die letzten 500 Aufrufe. Die Umbenennung ändert weder den `ads_management`-Identifier noch den Connectorcode.[3] Die vereinfachte Tier-Beantragung ohne separaten Recording-Upload hebt die dokumentierten Screencast-Anforderungen des **Permission Reviews** nicht automatisch auf; beide Freigabepfade werden deshalb in der Staging-Checkliste getrennt behandelt.

## Sichere Reconnect-Regel

Facebook Login for Business speichert Tokenart, Assets und Berechtigungen als Meta-seitige **Login-Konfiguration**. Der OAuth-Aufruf übergibt deren `config_id`; Meta zeigt dem Kunden genau diese Konfiguration an.[5] Die Anwendung hält zwar `ads_management` in ihrer erwarteten Scope-Allowlist, kann den Scope bei diesem Flow aber nicht allein dadurch in einen bereits bestehenden `config_id` aufnehmen. Die Login-Konfiguration hinter `META_LOGIN_CONFIG_ID` muss deshalb im Meta App Dashboard ausdrücklich `ads_management` enthalten.

Der am 30. Juli 2026 geprüfte Dialog der aktuellen Staging-Konfiguration zeigte ausschließlich den menschenlesbaren Zugriff auf Facebook-Werbeanzeigen und Statistiken sowie die bestehenden Seiten-/Instagram-Leserechte. Er bot keine separate Schreibauswahl. Dieser Dialog wird deshalb **nicht** als Schreibfreigabe akzeptiert. Der reale Staging-Redirect bestätigt als verwendete Login-Konfiguration **`1016826894673383`**. Vor einem weiteren Reconnect ist im Meta App Dashboard unter **Facebook Login for Business → Configurations** genau dieser Datensatz zu prüfen: Er muss `ads_management` enthalten, und die Permission muss unter **App Review → Permissions and Features** mindestens für den beabsichtigten eigenen Testkontext verfügbar sein. OAuth-State, Token oder Zugangsdaten werden dabei nicht dokumentiert.

Bereits ausgestellte Tokens erhalten einen nachträglich ergänzten Scope nicht automatisch. Nach der korrigierten Login-Konfiguration muss der Staging-Connector daher einen **expliziten Reconnect** verlangen, bevor irgendeine schreibende Policy aktiviert werden kann. Für zuvor fehlende oder abgelehnte Berechtigungen dokumentiert Meta den Login-Dialog-Parameter `auth_type=rerequest`; der Reconnect-Pfad setzt ihn deshalb ausdrücklich.[4] Callback und Tokenprüfung müssen `ads_management` in der tatsächlich gewährten Scope-Menge nachweisen; ein fehlender Scope führt fail-closed zurück ins Dashboard.

Der Reconnect darf historische Read-Snapshots, lokale Remote-ID-Bindings, Audit-Ereignisse oder Kundenrichtlinien nicht löschen. Die neue Verbindung ersetzt nur den verschlüsselten Token und die aktuelle Asset-Auswahl innerhalb des bereits tenantgebundenen Account-Datensatzes. Der Account-Kill-Switch bleibt dabei unverändert; insbesondere darf ein Reconnect niemals implizit von `FREEZE_WRITES` auf `ALLOW` wechseln.

## Implementierter Defense-in-depth-Vertrag

Der Scope ist nicht lediglich Bestandteil des Login-Dialogs. Er wird an allen schreibfreigebenden Grenzen erneut geprüft. Dadurch kann weder ein veralteter Browserzustand noch ein direkter Aufruf einer service-role-Route die Autonomie ohne tatsächlich gespeicherten Scope aktivieren.

| Grenze | Implementiertes Verhalten |
| --- | --- |
| OAuth-Start | Übergibt den versionierten Facebook-Login-for-Business-`config_id` mit `auth_type=rerequest`. Die Meta-seitige Konfiguration muss die kanonische Minimalmenge einschließlich `ads_management` enthalten; `business_management` wird nicht benötigt. |
| Callback | Verlangt alle erwarteten Scopes und bildet zulässige Werbekonten aus den granularen Zielen von `ads_read` und `ads_management`; ein Scope ohne freigegebenes Konto genügt nicht. |
| Dashboard | Zeigt den abgeleiteten Scope-Status, bietet den expliziten Reconnect an und blockiert aktive Autonomie sowie `ALLOW`, solange `ads_management` fehlt. |
| Server-Service | Prüft den gespeicherten Scope erneut, bevor eine aktive Policy oder `ALLOW` an einen privilegierten RPC weitergegeben wird. |
| Datenbank-RPC | Erzwingt tenantgebunden denselben Scope für `p_enable_automation = true` und `p_mode = 'ALLOW'`. `OFF`, `FREEZE_WRITES` und `PAUSE_MANAGED` bleiben auch ohne Scope möglich. |
| Executor | Claim und Reconciliation bleiben zusätzlich an aktuellen Scope, Tokenstatus, Kundenpolicy, Kill-Switch, EUR-Caps und Readiness gebunden. |
| Reconnect-Regression | Eine eigene temporäre Alt-Schema-Datenbank beweist, dass der Reconnect `ads_management` persistiert, aber Connector-ID, Baseline, Asset-Identitäten und historische Inhalte bewahrt. |

## Interaktiver Staging-Ablauf

Ein Reconnect wird **nicht automatisiert ausgelöst**, weil der Meta-Dialog eine bewusste Berechtigungsbestätigung des Kontoinhabers verlangt. Vor dem ersten Staging-Write bleibt der Kill-Switch auf `FREEZE_WRITES`. Der folgende Ablauf ist die Freigabereihenfolge; ein späterer Schritt darf keinen früheren ersetzen.

| Reihenfolge | Nachweis | Abbruchbedingung |
| ---: | --- | --- |
| 1 | Isoliertes Staging-Deployment, dediziertes freigegebenes Meta-Werbekonto und EUR-Kontowährung sind bestätigt. | Fremdkundenkonto, Production-Account oder Nicht-EUR-Konto. |
| 2 | Im Meta App Dashboard ist unter **Facebook Login for Business → Configurations** für den von `META_LOGIN_CONFIG_ID` referenzierten Datensatz `ads_management` ausgewählt; **App Review → Permissions and Features** zeigt den erforderlichen Zugriff für den beabsichtigten Kontotyp. | Login-Konfiguration enthält nur `ads_read`, Reviewstatus ist unklar oder Permission ist nicht auswählbar. |
| 3 | Im Dashboard wird bei weiterhin aktivem `FREEZE_WRITES` „Meta sicher neu verbinden“ gestartet; der Kunde wählt nur das vorgesehene Werbekonto und die nötigen Brand-Assets. Die lokalisierte Dialogbeschreibung ist kein alleiniger Scope-Nachweis. | Falsches Werbekonto, unerwartete Zusatzberechtigung oder unklare Asset-Auswahl. |
| 4 | Das Dashboard zeigt „Minimaler Schreibscope bestätigt“; Read-Sync, Baseline und historische Inhalte sind weiterhin vorhanden. | Fehlende Readiness oder verlorene Historie. |
| 5 | Kunden-Caps, Status-/Budgetfreigaben, Brand-Profil, Domain, Blueprint und Assets werden geprüft; die Policy bleibt zunächst `OFF`. | Fehlende Bestätigung oder nicht erfülltes Gate. |
| 6 | Erst im separaten Staging-Smoke-Test werden Policy und `ALLOW` kurzzeitig und begründet freigegeben. Jeder Write muss Remote-Read-back, Reconciliation und Audit vollständig abschließen. | Drift, Rate-Limit ohne sichere Wiederaufnahme, unbekannter Remotezustand oder Audit-Lücke; sofort `PAUSE_MANAGED`. |

Der reproduzierbare Nachweis läuft über `npm run test:meta-readonly`, `npm run test:dashboard-meta-connector`, `npm run test:meta-customer-controls` und `npm run test:meta-write-control-plane`. Der letzte Befehl enthält nun auch die Reconnect-Persistenzprüfung in einer getrennten temporären PostgreSQL-Datenbank.

## Verifizierter Staging-Reconnect vom 30. Juli 2026

Die Login-Konfiguration `1016826894673383` wurde Meta-seitig um `ads_management` ergänzt. Die finale, kundenbestätigte Berechtigungsauswahl umfasste exakt `ads_management`, `ads_read`, `instagram_basic`, `pages_read_engagement` und `pages_show_list`; `business_management` blieb deaktiviert. Der erneute OAuth-Dialog nannte nun ausdrücklich das Verwalten von Anzeigen für freigegebene Werbekonten. Der Callback bestätigte anschließend den minimalen Meta-Schreibscope.

Der danach ausschließlich lesend geprüfte Dashboardzustand blieb **fail-closed**: `FREEZE_WRITES` war weiterhin wirksam, Autonomie blieb aus, es existierte keine aktive Kunden-Policy und die unveränderliche Control-Plane-Auditkette enthielt noch null Ereignisse. Der Scope-Reconnect hat somit weder `ALLOW` gesetzt noch einen Plan erzeugt, eine Remote-Mutation ausgelöst oder bestehende Kampagnen verändert.

## Quellen

[1]: [Meta for Developers – Marketing API Authorization](https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/authorization)
[2]: [Meta for Developers – Permissions Reference (`ads_management`, `ads_read`)](https://developers.facebook.com/docs/permissions/)
[3]: [Meta for Developers – Update to Ads Management Standard Access, 4. Mai 2026](https://developers.meta.com/blog/updates-to-ads-management-standard-access-feature/)
[4]: [Meta for Developers – Manually Build a Login Flow, Re-asking for Declined Permissions](https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow)
[5]: [Meta for Developers – Facebook Login for Business](https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business)
