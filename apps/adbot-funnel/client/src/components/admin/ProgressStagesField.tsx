import { Plus, Trash2 } from "lucide-react";
import type { FunnelPage, FunnelProgressStage } from "@shared/funnel";
import { isFunnelPageHidden, visibleFunnelPages } from "@shared/funnel";
import { defaultProgressStages, MAX_PROGRESS_STAGES, resolveProgressStepCopy } from "@shared/progressLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ProgressStagesField({
  pages,
  stages,
  onChange,
}: {
  pages: FunnelPage[];
  stages: FunnelProgressStage[];
  onChange: (stages: FunnelProgressStage[]) => void;
}) {
  const visible = visibleFunnelPages(pages);
  const current = stages.length > 0 ? stages : defaultProgressStages(pages);

  const update = (next: FunnelProgressStage[]) => {
    onChange(next);
  };

  const addStage = () => {
    if (current.length >= MAX_PROGRESS_STAGES || visible.length === 0) return;
    const used = new Set(current.map(stage => stage.startPageId));
    const start = visible.find(page => !used.has(page.id)) ?? visible[visible.length - 1]!;
    update([
      ...current,
      { id: crypto.randomUUID(), label: resolveProgressStepCopy(start).title, startPageId: start.id },
    ]);
  };

  return (
    <div className="grid gap-3">
      <div>
        <Label>Balken</Label>
        <p className="mt-1 text-xs text-muted-foreground">
          Jeder Balken beginnt auf einer Seite und bleibt aktiv, bis der nächste startet. Beispiel: erster Balken beim Aufruf, zweiter ab Seite 2, dritter auf der Adresseingabe.
        </p>
      </div>
      {current.map((stage, index) => (
        <div className="grid gap-2 rounded-xl border bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" key={stage.id}>
          <Input
            value={stage.label}
            maxLength={40}
            placeholder={`Balken ${index + 1}`}
            aria-label={`Beschriftung Balken ${index + 1}`}
            onChange={event => update(current.map(item => item.id === stage.id ? { ...item, label: event.target.value } : item))}
          />
          <select
            className="h-9 rounded-md border bg-white px-3 text-sm"
            value={stage.startPageId}
            aria-label={`Startseite für ${stage.label || `Balken ${index + 1}`}`}
            onChange={event => update(current.map(item => item.id === stage.id ? { ...item, startPageId: event.target.value } : item))}
          >
            {pages.map((page, pageIndex) => (
              <option key={page.id} value={page.id} disabled={isFunnelPageHidden(page)}>
                {isFunnelPageHidden(page) ? "Ausgeblendet" : `${pageIndex + 1}.`} {page.name}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="shrink-0 text-destructive"
            disabled={current.length <= 1}
            aria-label={`Balken ${stage.label || index + 1} löschen`}
            onClick={() => update(current.filter(item => item.id !== stage.id))}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" className="justify-center" disabled={current.length >= MAX_PROGRESS_STAGES} onClick={addStage}>
        <Plus className="size-4" />
        Weiteren Balken hinzufügen
      </Button>
    </div>
  );
}
