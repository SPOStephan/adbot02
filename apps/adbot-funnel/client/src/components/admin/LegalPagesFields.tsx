import type { FunnelConfig, FunnelLegal, LegalPageMode } from "@shared/funnel";
import { resolveLegalPageMode } from "@shared/legalPages";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function ModePicker({
  label,
  description,
  value,
  onChange,
  internalHint,
  externalHint,
}: {
  label: string;
  description: string;
  value: LegalPageMode;
  onChange: (mode: LegalPageMode) => void;
  internalHint: string;
  externalHint: string;
}) {
  return (
    <div className="grid gap-3">
      <div>
        <p className="text-sm font-bold">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={label}>
        <button
          type="button"
          role="radio"
          aria-checked={value === "internal"}
          className={`rounded-xl border p-4 text-left transition ${value === "internal" ? "border-[#0165c3] bg-blue-50 ring-1 ring-[#0165c3]" : "hover:border-slate-300"}`}
          onClick={() => onChange("internal")}
        >
          <strong className="block text-sm">Eigene Seite in Adbot</strong>
          <span className="mt-1 block text-xs text-muted-foreground">{internalHint}</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={value === "external"}
          className={`rounded-xl border p-4 text-left transition ${value === "external" ? "border-[#0165c3] bg-blue-50 ring-1 ring-[#0165c3]" : "hover:border-slate-300"}`}
          onClick={() => onChange("external")}
        >
          <strong className="block text-sm">Externe URL</strong>
          <span className="mt-1 block text-xs text-muted-foreground">{externalHint}</span>
        </button>
      </div>
    </div>
  );
}

export function LegalPagesFields({
  legal,
  privacyUrl,
  slug,
  onChange,
}: {
  legal: FunnelLegal;
  privacyUrl: string;
  slug: string;
  onChange: (next: Pick<FunnelConfig, "legal" | "privacyUrl">) => void;
}) {
  const imprintMode = resolveLegalPageMode(legal.imprintMode, "internal");
  const privacyMode = resolveLegalPageMode(legal.privacyMode, "external");
  const patchLegal = (patch: Partial<FunnelLegal>) => onChange({ legal: { ...legal, ...patch }, privacyUrl });

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 rounded-2xl border p-4">
        <ModePicker
          label="Datenschutz"
          description="Footer-Link „Datenschutzerklärung“. Entweder eigene Seite mit Text oder vorhandene HTTPS-Adresse."
          value={privacyMode}
          onChange={privacyMode => patchLegal({ privacyMode })}
          internalHint={`Pflichttext, sichtbar unter /f/${slug}/datenschutz.`}
          externalHint="Weiterleitung zur bestehenden Datenschutzerklärung."
        />
        {privacyMode === "internal" ? (
          <>
            <div className="grid gap-2">
              <Label htmlFor="privacy-title">Überschrift</Label>
              <Input
                id="privacy-title"
                maxLength={160}
                value={legal.privacyTitle}
                onChange={event => patchLegal({ privacyTitle: event.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="privacy-content">Inhalt</Label>
              <Textarea
                id="privacy-content"
                rows={10}
                maxLength={20_000}
                value={legal.privacyContent}
                placeholder="Datenschutzerklärung als reiner Text. Absätze und Zeilenumbrüche bleiben erhalten."
                onChange={event => patchLegal({ privacyContent: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">Pflichtangabe für die eigene Seite. Wird sicher als Text ausgegeben.</p>
            </div>
          </>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="privacy-url">Datenschutz-URL</Label>
            <Input
              id="privacy-url"
              type="url"
              inputMode="url"
              placeholder="https://www.unternehmen.de/datenschutz"
              value={privacyUrl}
              onChange={event => onChange({ legal, privacyUrl: event.target.value.trim() })}
            />
            <p className="text-xs text-muted-foreground">Nur absolute HTTPS-Adressen. Der Footer öffnet die Seite in einem neuen Tab.</p>
          </div>
        )}
      </div>

      <div className="grid gap-4 rounded-2xl border p-4">
        <ModePicker
          label="Impressum"
          description="Footer-Link „Impressum“. Entweder eigene Seite mit Anbieterangaben oder vorhandene HTTPS-Adresse."
          value={imprintMode}
          onChange={imprintMode => patchLegal({ imprintMode })}
          internalHint={`Pflichttext, sichtbar unter /f/${slug}/impressum.`}
          externalHint="Weiterleitung zum bestehenden Impressum."
        />
        {imprintMode === "internal" ? (
          <>
            <div className="grid gap-2">
              <Label htmlFor="imprint-title">Überschrift</Label>
              <Input
                id="imprint-title"
                maxLength={160}
                value={legal.imprintTitle}
                onChange={event => patchLegal({ imprintTitle: event.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="imprint-content">Inhalt</Label>
              <Textarea
                id="imprint-content"
                rows={10}
                maxLength={20_000}
                value={legal.imprintContent}
                placeholder="Vollständige Anbieterangaben, Vertretungsberechtigte, Kontakt und gegebenenfalls Register- und Steuerangaben"
                onChange={event => patchLegal({ imprintContent: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">Pflichtangabe für die eigene Seite. Wird sicher als Text ausgegeben.</p>
            </div>
          </>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="imprint-url">Impressum-URL</Label>
            <Input
              id="imprint-url"
              type="url"
              inputMode="url"
              placeholder="https://www.unternehmen.de/impressum"
              value={legal.imprintUrl}
              onChange={event => patchLegal({ imprintUrl: event.target.value.trim() })}
            />
            <p className="text-xs text-muted-foreground">Nur absolute HTTPS-Adressen. Der Footer öffnet die Seite in einem neuen Tab.</p>
          </div>
        )}
      </div>
    </div>
  );
}
