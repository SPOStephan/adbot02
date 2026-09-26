import { useState } from "react";
import { GripVertical, Trash2 } from "lucide-react";
import type { StartBadge } from "@shared/funnel";
import { badgeFromTemplate, emptyStartBadge, MAX_START_BADGES, moveStartBadge, resolveBadgeColors, START_BADGE_TEMPLATES } from "@shared/startLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IconColorField } from "@/components/admin/IconColorField";

const BADGE_DRAG_TYPE = "application/x-adbot-start-badge";

export function StartBadgesField({
  badges,
  brandColor,
  onChange,
}: {
  badges: StartBadge[];
  brandColor: string;
  onChange: (badges: StartBadge[]) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const atLimit = badges.length >= MAX_START_BADGES;
  const editing = badges.find(badge => badge.id === editingId) ?? null;

  const add = (badge: StartBadge, edit = false) => {
    if (atLimit) return;
    onChange([...badges, badge]);
    if (edit) setEditingId(badge.id);
  };

  const patch = (id: string, next: Partial<StartBadge>) => {
    onChange(badges.map(item => item.id === id ? { ...item, ...next } : item));
  };

  return (
    <div className="grid gap-3 rounded-xl border bg-slate-50 p-3">
      <div>
        <p className="text-sm font-bold">Badges (optional)</p>
        <p className="text-xs text-muted-foreground">
          Kleine Chips unter der Überschrift. Vorlagen einsetzen oder eigene anlegen. Ziehen ändert die Reihenfolge, Doppelklick öffnet Text und Farben.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {START_BADGE_TEMPLATES.map(label => (
          <Button
            key={label}
            type="button"
            size="sm"
            variant="outline"
            className="h-7 bg-white px-2 text-xs"
            disabled={atLimit}
            onClick={() => add(badgeFromTemplate(label))}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <Label>Eingefügte Badges</Label>
        <Button size="sm" variant="outline" disabled={atLimit} onClick={() => add(emptyStartBadge(), true)}>
          Badge hinzufügen
        </Button>
      </div>
      {badges.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Eingefügte Badges, ziehen zum Sortieren">
          {badges.map(badge => {
            const colors = resolveBadgeColors(badge, brandColor);
            const isDragging = draggingId === badge.id;
            const isDropTarget = dropTargetId === badge.id && draggingId !== badge.id;
            const isEditing = editingId === badge.id;
            return (
              <li
                key={badge.id}
                className={`inline-flex max-w-full items-center gap-1 rounded-full border px-1 py-1 ${isDropTarget ? "ring-2 ring-[#0165c3]" : ""} ${isDragging ? "opacity-50" : ""} ${isEditing ? "ring-2 ring-slate-400" : ""}`}
                style={{ background: colors.background, color: colors.text, borderColor: badge.backgroundColor || "color-mix(in srgb, #10253f 14%, transparent)" }}
                onDragOver={event => {
                  if (!draggingId) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropTargetId(badge.id);
                }}
                onDrop={event => {
                  event.preventDefault();
                  const fromId = event.dataTransfer.getData(BADGE_DRAG_TYPE) || event.dataTransfer.getData("text/plain");
                  onChange(moveStartBadge(badges, fromId, badge.id));
                  setDraggingId(null);
                  setDropTargetId(null);
                }}
                onDragLeave={event => {
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                  if (dropTargetId === badge.id) setDropTargetId(null);
                }}
              >
                <button
                  type="button"
                  className="grid size-7 shrink-0 cursor-grab place-items-center rounded-full hover:bg-black/5 active:cursor-grabbing"
                  draggable
                  aria-label={`${badge.label} verschieben`}
                  onDragStart={event => {
                    event.dataTransfer.setData(BADGE_DRAG_TYPE, badge.id);
                    event.dataTransfer.setData("text/plain", badge.id);
                    event.dataTransfer.effectAllowed = "move";
                    setDraggingId(badge.id);
                  }}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setDropTargetId(null);
                  }}
                >
                  <GripVertical className="size-3.5 opacity-70" />
                </button>
                <button
                  type="button"
                  className="max-w-[12rem] truncate px-1 text-left text-xs font-semibold"
                  aria-label={`${badge.label} bearbeiten`}
                  title="Doppelklick zum Bearbeiten"
                  onDoubleClick={() => setEditingId(badge.id)}
                >
                  {badge.label || "Badge"}
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 shrink-0 text-current hover:bg-black/5"
                  aria-label={`${badge.label} löschen`}
                  onClick={() => {
                    if (editingId === badge.id) setEditingId(null);
                    onChange(badges.filter(item => item.id !== badge.id));
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Noch keine Badges eingefügt.</p>
      )}
      {editing ? (
        <div className="grid gap-3 rounded-xl border bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold">Badge bearbeiten</p>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)}>Fertig</Button>
          </div>
          <Input
            value={editing.label}
            maxLength={80}
            autoFocus
            aria-label="Badge-Text"
            onChange={event => patch(editing.id, { label: event.target.value })}
            onKeyDown={event => {
              if (event.key === "Escape") setEditingId(null);
            }}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <IconColorField
              label="Hintergrund"
              value={editing.backgroundColor}
              brandColor="#ffffff"
              onChange={color => patch(editing.id, { backgroundColor: color })}
            />
            <IconColorField
              label="Textfarbe"
              value={editing.textColor}
              brandColor={brandColor}
              onChange={color => patch(editing.id, { textColor: color })}
            />
          </div>
        </div>
      ) : null}
      {atLimit ? <p className="text-xs text-muted-foreground">Maximal {MAX_START_BADGES} Badges.</p> : null}
    </div>
  );
}
