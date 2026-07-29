# Meta Marketing API v25 – Implementierungsnotizen

**Verifiziert:** 29. Juli 2026  
**Zweck:** Konkrete Feld- und Ablaufdetails für den getrennten serverseitigen Write-Client. Diese Notizen ergänzen den übergeordneten [`META_WRITE_API_CONTRACT.md`](./META_WRITE_API_CONTRACT.md).

## Verifizierte Create-Kanten

| Objekt | Graph-v25-Kante | Wesentliche Rückgabe |
|---|---|---|
| Kampagne | `POST /v25.0/act_<AD_ACCOUNT_ID>/campaigns` | `{ id, success }`; Read-after-write wird unterstützt |
| Anzeigengruppe | `POST /v25.0/act_<AD_ACCOUNT_ID>/adsets` | Objekt-ID beziehungsweise Validierungserfolg; anschließend separates Read-after-write |
| Creative | `POST /v25.0/act_<AD_ACCOUNT_ID>/adcreatives` | Creative-ID; anschließend separates Read-after-write |
| Anzeige | `POST /v25.0/act_<AD_ACCOUNT_ID>/ads` | `{ id, success }`; Read-after-write wird unterstützt |

## Vorabvalidierung

Kampagnen und Anzeigengruppen akzeptieren `execution_options` mit `validate_only` und optional `include_recommendations`. Ads akzeptieren `execution_options` mit `validate_only`, `synchronous_ad_review` und optional `include_recommendations`. `synchronous_ad_review` ist ausdrücklich **keine** endgültige Review-Entscheidung. Der Write-Client behandelt die Optionen als serverseitig erzeugte Kontrollfelder; sie dürfen nicht frei aus einem Blueprint-Payload übernommen werden.

Die aktuelle Creative-Referenz dokumentiert für die eigenständige `adcreatives`-Erstellung keine `validate_only`-Option. Adbot erfindet deshalb keinen solchen Parameter. Ein Creative wird erst nach atomarem Saga-Step-Claim tatsächlich erstellt, anhand seiner ID sofort wieder gelesen und bei jeder Abweichung kontoweise gesperrt. Der nachfolgende Ad-`validate_only`-Aufruf prüft die konkrete Creative-Referenz zusätzlich vor dem Active-Create.

## Aktive Anzeige

Die Ad-Erstellung akzeptiert `status=ACTIVE`. Eine neu erstellte Anzeige bleibt zunächst in Meta Review; nach Freigabe kann sie automatisch ausliefern. Für den geforderten Active-Launch darf der tatsächliche Create-Call daher `ACTIVE` enthalten, aber ausschließlich nach lokaler Objektkettenprüfung, Hard-Cap-Reservierung, Lease/Plan-Claim und erfolgreichem `validate_only` mit synchroner Integrity-Prüfung. Ein Validierungscall selbst darf kein auslieferndes Objekt erzeugen.

## Budgetebene und Shared Budget

Kampagnenbudgets und Ad-Set-Budgets dürfen innerhalb derselben Struktur nicht gleichzeitig gesetzt werden. Die Kampagnenkante dokumentiert `daily_budget`, `lifetime_budget` und `is_adset_budget_sharing_enabled`. Ad-Set-Budgets verwenden ebenfalls `daily_budget` oder `lifetime_budget`, jeweils als Integer in der kleinsten Währungseinheit. Die Control Plane reserviert für normale Tagesbudgets mindestens Faktor 1,75 und bei aktiviertem Budget-Sharing mindestens Faktor 2,10.

## Ad-Create-Felder

Der aktuelle Ad-Create-Vertrag führt insbesondere `name`, `adset_id`, `creative`, `status`, `conversion_domain`, `ad_schedule_start_time`, `ad_schedule_end_time`, `tracking_specs`, `adlabels`, `authorization_category` und `execution_options` auf. `conversion_domain` ist nur die registrierbare Domain, nicht die vollständige Landingpage-URL. Der erste Updateumfang für bestehende Ads bleibt bewusst auf `status` begrenzt.

## Ad-Set-Kernfelder

Der aktuelle Ad-Set-Vertrag führt für die objektivspezifischen Blueprints insbesondere `campaign_id`, `name`, genau eines von `daily_budget` oder `lifetime_budget`, `billing_event`, `optimization_goal`, `targeting`, `status`, `promoted_object`, `destination_type`, `attribution_spec`, `bid_amount`, `bid_strategy`, Zeitplanfelder und `execution_options` auf. Targeting- und Promoted-Object-Strukturen werden nicht vom Write-Client erfunden, sondern ausschließlich aus versionierten, kundenbestätigten Blueprints übernommen.

## Compliance

Die Referenz vom 23. Juli 2026 beschreibt zusätzliche Sperren für Custom Audiences und Custom Conversions, die möglicherweise unzulässige Gesundheits- oder Finanzinformationen erkennen lassen. Solche Meta-Fehler dürfen weder durch automatisches Entfernen noch durch Ersetzen von Compliancefeldern umgangen werden. Für EU/DSA-Zielregionen müssen Zahler-/Begünstigtenangaben vor Ad-Erstellung vollständig vorliegen; der Executor sperrt andernfalls den Plan.

## Quellen

1. [Meta: Ad Account, Ad Campaigns – v25, aktualisiert 11. Mai 2026](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account/campaigns)
2. [Meta: Ad Set – v25, aktualisiert 23. Juli 2026](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-campaign)
3. [Meta: Ad Creative – v25, aktualisiert 24. März 2026](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-creative)
4. [Meta Graph API: Ad – v25](https://developers.facebook.com/docs/graph-api/reference/adgroup)
