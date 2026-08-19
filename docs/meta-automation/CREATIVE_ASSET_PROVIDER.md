# Creative-Asset-Provider und Brand-Asset-Katalog

## Zweck und Laufzeitgrenze

Die Creative-Asset-Schicht stellt eine **austauschbare, vollständig Manus-unabhängige Laufzeitschnittstelle** bereit. Der produktive Server ruft einen kundenseitig konfigurierten HTTPS-Provider auf, validiert dessen Resultat deterministisch, speichert Bildbytes in einem privaten Supabase-Bucket und schreibt die vollständige Provenienz in die bestehende Control Plane. Manus wird weder für Queue-Verarbeitung noch für Generierung, Speicherung, Moderationsstatus oder Freigabe benötigt.

Bestehende geprüfte Brand-Assets werden über den Katalog bevorzugt wiederverwendet. Eine neue Generierung wird nur empfohlen, wenn kein `READY`-Asset den geforderten MIME-, Dimensions- und Seitenverhältnisbedingungen entspricht. Das Auswahlverfahren ist deterministisch und bevorzugt bei gleicher Brand-Policy-Version bereits zu Meta hochgeladene Assets.

## Laufzeitkomponenten

| Komponente | Verantwortung | Sicherheitsgrenze |
| --- | --- | --- |
| `brand_profiles` | Versionierte Markenidentität, Guidelines und Freigabemodus | Intent nach Erstellung unveränderlich; genau eine aktive Version je Werbekonto |
| `brand_assets` | Verifizierte bestehende, hochgeladene oder generierte Assets | `READY` nur nach `APPROVED`; tenantgebunden; SHA-256-eindeutig |
| `creative_asset_jobs` | Idempotente Providerqueue und Leasezustand | Browser nur eingeschränkte Lesesicht; Payload ausschließlich serverseitig |
| HTTP-v1-Provider | Generierung und Provider-Moderationsresultat | HTTPS, Bearer-Key, Idempotency-Key und feste Asset-Hostallowlist |
| Worker | Claim, Pre-Dispatch-Gate, Provideraufruf, Validierung, Storage, Completion | Ein atomarer Job pro Cronlauf; keine Wiederholung nach ambigem Transport |
| Brand-Asset-Katalog | Deterministische Reuse-or-Generate-Entscheidung | Liest ausschließlich `READY` und `APPROVED` |

## Providerkonfiguration

Alle Werte werden ausschließlich als serverseitige Vercel-Umgebungsvariablen hinterlegt. Eine teilweise Konfiguration wird abgelehnt; Providerjobs werden dann nicht geclaimt.

`CREATIVE_ASSET_PROVIDER_KEY` wählt den aktiven Adapter:

- `openrouter` → OpenRouter Image API (Phase 2; siehe `CREATIVE_GENERATION_PHASE2.md`)
- jeder andere gültige Key (z. B. `http`) → bestehender HTTP-v1-Provider

### HTTP-Provider

| Variable | Pflicht | Bedeutung |
| --- | --- | --- |
| `CREATIVE_ASSET_PROVIDER_KEY` | Ja | Stabiler Providerbezeichner gemäß `^[a-z][a-z0-9_-]{1,63}$` (nicht `openrouter`) |
| `CREATIVE_ASSET_PROVIDER_ENDPOINT` | Ja | Credential-freie HTTPS-POST-URL, ausschließlich Port 443 |
| `CREATIVE_ASSET_PROVIDER_API_KEY` | Ja | Serverseitiger Bearer-Key; niemals Datenbank- oder Browserinhalt |
| `CREATIVE_ASSET_PROVIDER_ASSET_HOSTS` | Ja | Kommaseparierte exakte Hostnamen für Assetdownloads; keine Wildcards |
| `CREATIVE_ASSET_PROVIDER_TIMEOUT_MS` | Nein | Providerzeitlimit von 5.000 bis 120.000 Millisekunden; Standard 60.000 |
| `CREATIVE_ASSET_STORAGE_BUCKET` | Nein | Privater Supabase-Bucket; Standard `creative-assets` |
| `CRON_SECRET` | Ja | Gemeinsames Cron-Bearer-Secret mit mindestens 32 Zeichen |

### OpenRouter-Provider (`CREATIVE_ASSET_PROVIDER_KEY=openrouter`)

| Variable | Pflicht | Bedeutung |
| --- | --- | --- |
| `OPENROUTER_API_KEY` oder `CREATIVE_ASSET_OPENROUTER_API_KEY` | Ja | Bearer-Key |
| `CREATIVE_ASSET_OPENROUTER_MODEL_ALLOWLIST` | Ja | Kommaseparierte Modell-Slugs |
| `CREATIVE_ASSET_OPENROUTER_DEFAULT_MODEL` | Nein | Optional; muss in der Allowlist liegen |
| `CREATIVE_ASSET_OPENROUTER_BASE_URL` | Nein | Standard `https://openrouter.ai/api/v1` |
| `CREATIVE_ASSET_OPENROUTER_TIMEOUT_MS` | Nein | 5.000–120.000; Fallback `CREATIVE_ASSET_PROVIDER_TIMEOUT_MS` |
| `CREATIVE_ASSET_OPENROUTER_ASSET_HOSTS` | Nein* | Nur nötig, wenn Antworten URLs statt `b64_json` liefern |
| `CREATIVE_ASSET_OPENROUTER_HTTP_REFERER` / `CREATIVE_ASSET_OPENROUTER_APP_TITLE` | Nein | Empfohlene OpenRouter-Header |

## HTTP-v1-Anfrage

Der Worker sendet `POST` mit `Content-Type: application/json`, `Authorization: Bearer …`, `Idempotency-Key` und `X-Adbot-Contract-Version: adbot-creative-assets-v1`. Der Provider **muss denselben Idempotency-Key dauerhaft auf dasselbe logische Ergebnis abbilden**.

```json
{
  "contract_version": "adbot-creative-assets-v1",
  "job_id": "uuid",
  "idempotency_key": "64-stelliger SHA-256",
  "model": "provider-model",
  "model_version": "optional",
  "input_hash": "64-stelliger SHA-256",
  "input": {
    "prompt": "Provider-spezifischer, secretfreier Intent"
  }
}
```

Die Datenbank begrenzt den kanonischen Input auf **64 KiB** und lehnt normalisierte sensible Schlüssel rekursiv ab, einschließlich Varianten wie `access-token`, `API-Key`, `client_secret`, `password` oder `private-key`. Der TypeScript-Worker wiederholt diese Prüfung an der Prozessgrenze.

## HTTP-v1-Antwort

Eine erfolgreiche Antwort ist ein JSON-Objekt mit genau einer Assetquelle: `asset_base64` **oder** `download_url`.

```json
{
  "request_id": "optional-provider-request-id",
  "asset_id": "stabile-provider-asset-id",
  "file_name": "optional.png",
  "mime_type": "image/png",
  "moderation_status": "APPROVED",
  "download_url": "https://assets.provider.example/result.png",
  "metadata": {
    "model_revision": "2026-07"
  }
}
```

| Feld | Regel |
| --- | --- |
| `asset_id` | Pflicht, maximal 255 Zeichen |
| `mime_type` | Nur `image/png` oder `image/jpeg` |
| `moderation_status` | `PENDING`, `APPROVED` oder `REJECTED` |
| `asset_base64` | Höchstens 10 MiB decodiert; gegenseitig exklusiv mit `download_url` |
| `download_url` | HTTPS, Port 443, kein eingebettetes Credential, exakter freigegebener Host |
| `metadata` | Optionales secretfreies JSON-Objekt; Datenbanklimit 32 KiB |

Antwort-JSON ist auf 256 KiB begrenzt. Downloads folgen höchstens drei Redirects; **jeder** Zielhost wird erneut gegen die exakte Allowlist geprüft. PNGs benötigen eine vollständige, CRC-geprüfte `IHDR`/`IDAT`/`IEND`-Struktur ohne angehängte Bytes. JPEGs benötigen eine gültige Signatur, Dimensionssegmente und einen echten Endmarker.

## Zustandsautomat und Idempotenz

| Ausgang | Ereignis | Folgezustand | Erneuter Provideraufruf erlaubt |
| --- | --- | --- | --- |
| `PENDING`/`RETRYABLE` | Atomarer Claim | `CLAIMED` + `NOT_DISPATCHED` | Noch nicht |
| `CLAIMED` | Persistiertes Dispatch-Gate | `CLAIMED` + `DISPATCHED` | Einmalig unter demselben Idempotency-Key |
| `NOT_DISPATCHED` | Sicherer lokaler Fehler | `RETRYABLE` oder `FAILED` | Nur bei `RETRYABLE` |
| `DISPATCHED` | Eindeutiger Providerfehler | `RETRYABLE` oder `FAILED` | Nur mit garantierter Provideridempotenz |
| `DISPATCHED` | Unbekanntes Transportergebnis | `AMBIGUOUS` | Nein; manuelle Reconciliation erforderlich |
| `DISPATCHED` | Asset vollständig geprüft und gespeichert | `SUCCEEDED` | Nein |
| Abgelaufene Lease vor Dispatch | Reaper | `RETRYABLE`, danach neuer Claim | Ja |
| Abgelaufene Lease nach Dispatch | Reaper | `AMBIGUOUS` | Nein |

Enqueue und Claim setzen zusätzlich voraus: nicht widerrufener Meta-Account, aktuelle `ACTIVE`-Autonomiepolicy, `allow_new_launches = true`, aktive Brand-Profile-Version und effektiver Kill-Switch-Modus `ALLOW`.

## Freigabemodi

| Modus | Providerstatus `APPROVED` | Resultierender Assetstatus |
| --- | --- | --- |
| `AUTONOMOUS_POLICY` | Automatisch policy-geprüft | Sofort `READY`; `reviewed_at` gesetzt, `reviewed_by` bleibt `NULL` |
| `CUSTOMER_REVIEW` | Providerprüfung abgeschlossen | Zunächst `PENDING`; Kunde aktiviert anschließend über die Freigabe-RPC |
| Beide Modi | `PENDING` oder `REJECTED` | Nie automatisch `READY` |

Damit entspricht `AUTONOMOUS_POLICY` der Kundenfreigabe, neue sinnvolle Brand-Assets selbstständig anzulegen. Der Auditdatensatz behauptet dabei ausdrücklich **keine** manuelle Kundenprüfung.

## Privater Storage und Provenienz

Der Worker erzwingt einen privaten Bucket mit höchstens 10 MiB und den MIME-Typen PNG/JPEG. Der Pfad ist content-addressiert:

```text
{user_uuid}/{platform_account_uuid}/{sha256_prefix}/{sha256}.{png|jpg}
```

`upsert` ist für diesen Pfad sicher, weil SHA-256, validierte Bytes und Endung deterministisch zusammengehören. Die Completion-RPC akzeptiert ausschließlich dieses Pfadmuster und speichert Provider-ID, Request-ID, Modell, Version, Input-Hash, SHA-256, Maße, Moderationsstatus und secretfreie Metadaten.

## Cronbetrieb

Vercel ruft `/api/cron/creative-assets` alle fünf Minuten auf. Die Route verarbeitet absichtlich höchstens **einen** Job und setzt ein 150-Sekunden-Abbruchsignal innerhalb einer Funktionsgrenze von 180 Sekunden. Antworten enthalten nur `processed` und den terminalen/Queue-Status, niemals Job-ID, Asset-ID, Input, Providerantwort oder Credentialdaten. Alle Antworten verwenden `private, no-store`.

## Audit und Mandantentrennung

Jeder relevante Übergang schreibt in die accountweise SHA-256-verkettete `mutation_audit_events`-Historie. Browserrollen erhalten ausschließlich eigene Zeilen per RLS und bei Jobs nur eine explizite Spaltenliste ohne `input_payload`, Lease-Token, Providerrequest-ID oder interne Fehlerdetails. Alle mutierenden RPCs sind ausschließlich für `service_role` ausführbar. Cross-Tenant-Verknüpfungen werden zusätzlich durch Trigger geprüft, auch wenn ein privilegierter Prozess einen falschen Fremdschlüssel übermittelt.

## Generation contract v1 (Phase 1)

Phase 1 legt nur **Schema + Validierung** fest. Es gibt **keine** Live-Aufrufe an OpenRouter oder andere Bild-APIs und keine Worker-Änderungen für externe Generation.

| Baustein | Ort |
| --- | --- |
| Spalten `asset_role`, `training_status`, `marked_good_*`, `style_notes` | `brand_assets` |
| SQL-Validator | `creative_generation_input_contract_valid(jsonb)` |
| TypeScript | `src/lib/creative-assets/generation-contract.ts` |
| Migration | `supabase/migrations/20260818230000_creative_generation_phase1_contract.sql` |

**Model-open / OpenRouter-ready:** `provider_key` folgt `^[a-z][a-z0-9_-]{1,63}$` (z. B. `openrouter`, `http`); `model_id` ist 1–160 Zeichen.

Beispiel-Input (Shape):

```json
{
  "contract_version": "adbot-creative-generation-v1",
  "mode": "free",
  "provider_key": "openrouter",
  "model_id": "google/gemini-2.5-flash-image",
  "prompt": "optional",
  "reference_asset_ids": [],
  "locked_photo_asset_ids": [],
  "output": { "mime_type": "image/png", "aspect_hint": "1:1" }
}
```

Modi: `free` | `locked_photo` (`locked_photo_asset_ids` nicht-leer genau dann). Secrets werden über `meta_jsonb_has_sensitive_key` / TS-Spiegel abgelehnt. Details: `docs/meta-automation/CREATIVE_GENERATION_PHASE1.md`.

## Phase 2 (OpenRouter live)

Phase 2 verdrahtet den OpenRouter Image API-Client, die Provider-Registry, den Worker und `POST /api/meta/automation/creative-assets/enqueue` für **mode=`free`**. Siehe `docs/meta-automation/CREATIVE_GENERATION_PHASE2.md`.

## Phase 3 (Locked-Photo Compose)

Phase 3 schaltet **mode=`locked_photo`** frei: KI-Hintergrund + 1:1-Embed eines `LOCKED_PHOTO` mit Pixel-Guard (PNG). Siehe `docs/meta-automation/CREATIVE_GENERATION_PHASE3.md`.
