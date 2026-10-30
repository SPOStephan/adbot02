import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { StartRequirements } from "@shared/funnel";
import { contrastOnAccent } from "@shared/startLayout";
import { emptyStartRequirementItem, MAX_START_REQUIREMENTS, resolveStartRequirements } from "@shared/startRequirements";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CopySizeStepper } from "@/components/admin/CopySizeStepper";
import { FormattedTextField } from "@/components/admin/FormattedTextField";
import { IconColorField } from "@/components/admin/IconColorField";
import { IconPicker } from "@/components/admin/IconPicker";

export function StartRequirementsField({
  value,
  brandColor,
  brandTextColor,
  onChange,
}: {
  value?: StartRequirements;
  brandColor: string;
  brandTextColor: string;
  onChange: (update: (current: StartRequirements) => StartRequirements) => void;
}) {
  const requirements = resolveStartRequirements(value);
  const set = (next: Partial<StartRequirements>) => onChange(current => ({ ...current, ...next }));
  const atLimit = requirements.items.length >= MAX_START_REQUIREMENTS;
  const filled = requirements.iconStyle !== "plain";
  const circleColor = requirements.iconColor || brandColor;

  const move = (index: number, delta: number) => onChange(current => {
    const items = [...current.items];
    const target = index + delta;
    if (target < 0 || target >= items.length) return current;
    [items[index], items[target]] = [items[target]!, items[index]!];
    return { ...current, items };
  });

  return (
    <div className="grid gap-3 rounded-xl border bg-slate-50 p-3">
      <label className="flex items-center justify-between gap-3">
        <span>
          <strong className="block text-sm">Checkliste über den Vorteilen (optional)</strong>
          <small className="text-muted-foreground">Z. B. „Das bringst Du mit:“ mit Punkten und rundem Icon, direkt über der Trenner-Überschrift.</small>
        </span>
        <Switch checked={requirements.enabled} onCheckedChange={enabled => set({ enabled })} />
      </label>

      {requirements.enabled && (
        <>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Überschrift</Label>
              <CopySizeStepper value={requirements.titleSizeStep} onChange={titleSizeStep => set({ titleSizeStep })} areaLabel="Checkliste – Überschrift" />
            </div>
            <FormattedTextField rows={1} value={requirements.title} placeholder="Das bringst Du mit:" onChange={title => set({ title })} />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Punkte</Label>
              <div className="flex items-center gap-1">
                <CopySizeStepper value={requirements.textSizeStep} onChange={textSizeStep => set({ textSizeStep })} areaLabel="Checkliste – Punkte" />
              </div>
            </div>
            {requirements.items.map((item, index) => (
              <div className="flex items-start gap-1" key={item.id}>
                <div className="min-w-0 flex-1">
                  <FormattedTextField
                    rows={1}
                    value={item.text}
                    aria-label={`Punkt ${index + 1}`}
                    onChange={text => onChange(current => ({ ...current, items: current.items.map(entry => entry.id === item.id ? { ...entry, text } : entry) }))}
                  />
                </div>
                <Button size="icon" variant="ghost" className="size-8 shrink-0" aria-label="Nach oben" disabled={index === 0} onClick={() => move(index, -1)}>
                  <ArrowUp className="size-4" />
                </Button>
                <Button size="icon" variant="ghost" className="size-8 shrink-0" aria-label="Nach unten" disabled={index === requirements.items.length - 1} onClick={() => move(index, 1)}>
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 shrink-0 text-destructive"
                  aria-label={`Punkt ${index + 1} löschen`}
                  onClick={() => onChange(current => ({ ...current, items: current.items.filter(entry => entry.id !== item.id) }))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="justify-center bg-white"
              disabled={atLimit}
              onClick={() => onChange(current => ({ ...current, items: [...current.items, emptyStartRequirementItem()] }))}
            >
              Punkt hinzufügen
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Icon</Label>
              <IconPicker value={requirements.icon} color={filled ? contrastOnAccent(circleColor) : circleColor} onChange={icon => set({ icon })} />
            </div>
            <div className="grid gap-2">
              <Label>Icon-Darstellung</Label>
              <div className="grid grid-cols-2 gap-1.5">
                <Button type="button" size="sm" variant={filled ? "secondary" : "outline"} className="bg-white" aria-pressed={filled} onClick={() => set({ iconStyle: "filled" })}>
                  Im Kreis
                </Button>
                <Button type="button" size="sm" variant={!filled ? "secondary" : "outline"} className="bg-white" aria-pressed={!filled} onClick={() => set({ iconStyle: "plain" })}>
                  Nur Icon
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <IconColorField
              label={filled ? "Kreisfarbe" : "Iconfarbe"}
              value={requirements.iconColor || undefined}
              brandColor={brandColor}
              onChange={iconColor => set({ iconColor: iconColor ?? "" })}
            />
            {filled && (
              <IconColorField
                label="Icon im Kreis"
                value={requirements.iconGlyphColor || undefined}
                brandColor={contrastOnAccent(circleColor)}
                presetLabel="Automatisch"
                resetLabel="Automatisch"
                onChange={iconGlyphColor => set({ iconGlyphColor: iconGlyphColor ?? "" })}
              />
            )}
            <IconColorField
              label="Überschrift – Farbe"
              value={requirements.titleColor || undefined}
              brandColor={brandTextColor}
              presetLabel="Textfarbe"
              resetLabel="Textfarbe verwenden"
              onChange={titleColor => set({ titleColor: titleColor ?? "" })}
            />
            <IconColorField
              label="Punkte – Farbe"
              value={requirements.textColor || undefined}
              brandColor={brandTextColor}
              presetLabel="Textfarbe"
              resetLabel="Textfarbe verwenden"
              onChange={textColor => set({ textColor: textColor ?? "" })}
            />
            <IconColorField
              label="Hintergrund"
              value={requirements.background || undefined}
              brandColor="#FFFFFF"
              presetLabel="Weiß"
              resetLabel="Weiß verwenden"
              onChange={background => set({ background: background ?? "" })}
            />
          </div>
        </>
      )}
    </div>
  );
}
