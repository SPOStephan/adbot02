import { useState, type CSSProperties } from "react";
import { ArrowLeftRight, GripVertical, Trash2 } from "lucide-react";
import type { StartBadge } from "@shared/funnel";
import { badgeEditorBackground, badgeFromTemplate, emptyStartBadge, isLightColor, MAX_START_BADGES, moveStartBadge, patchStartBadge, MAX_BADGE_BORDER_WIDTH, resolveBadgeBorderColor, resolveBadgeBorderWidth, resolveBadgeColors, resolveBadgeIcon, resolveBadgeIconPosition, START_BADGE_TEMPLATES } from "@shared/startLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IconColorField } from "@/components/admin/IconColorField";
import { IconPicker } from "@/components/admin/IconPicker";
import { StartBadgeContent } from "@/components/funnel/StartBadgeContent";

const BADGE_DRAG_TYPE = "application/x-adbot-start-badge";

export function StartBadgesField({
  badges,
  brandColor,
  fallbackTextColor,
  onChange,
}: {
  badges: StartBadge[];
  brandColor: string;
  fallbackTextColor: string;
  onChange: (update: (current: StartBadge[]) => StartBadge[]) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const atLimit = badges.length >= MAX_START_BADGES;
  const editing = badges.find(badge => badge.id === editingId) ?? null;

  const add = (badge: StartBadge, edit = false) => {
    if (atLimit) return;
    onChange(current => [...current, badge]);
    if (edit) setEditingId(badge.id);
  };

  const patch = (id: string, next: Partial<StartBadge>) => {
    onChange(current => patchStartBadge(current, id, next));
  };

  return (
    <div className="grid gap-3 rounded-xl border bg-slate-50 p-3">
      <div>
        <p className="text-sm font-bold">Badges (optional)</p>
        <p className="text-xs text-muted-foreground">
          Kleine Chips unter der Überschrift. Vorlagen einsetzen oder eigene anlegen. Ziehen ändert die Reihenfolge, Doppelklick öffnet Text, Icon und Farben.
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
            const colors = resolveBadgeColors(badge, fallbackTextColor, brandColor);
            const isDragging = draggingId === badge.id;
            const isDropTarget = dropTargetId === badge.id && draggingId !== badge.id;
            const isEditing = editingId === badge.id;
            return (
              <li
                key={badge.id}
                className={`inline-flex max-w-full items-center gap-1 rounded-full border px-1 py-1 ${isDropTarget ? "ring-2 ring-[#0165c3]" : ""} ${isDragging ? "opacity-50" : ""} ${isEditing ? "ring-2 ring-slate-400" : ""}`}
                style={{ background: badgeEditorBackground(badge, colors.text, colors.background), color: colors.text, borderColor: resolveBadgeBorderColor(badge, colors.text, "color-mix(in srgb, #10253f 14%, transparent)"), borderWidth: resolveBadgeBorderWidth(badge.borderWidth), "--badge-fg": colors.text } as CSSProperties}
                onDragOver={event => {
                  if (!draggingId) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropTargetId(badge.id);
                }}
                onDrop={event => {
                  event.preventDefault();
                  const fromId = event.dataTransfer.getData(BADGE_DRAG_TYPE) || event.dataTransfer.getData("text/plain");
                  onChange(current => moveStartBadge(current, fromId, badge.id));
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
                  className="inline-flex max-w-[12rem] items-center gap-[0.4em] truncate px-1 text-left text-xs font-semibold"
                  aria-label={`${badge.label} bearbeiten`}
                  title="Doppelklick zum Bearbeiten"
                  onDoubleClick={() => setEditingId(badge.id)}
                >
                  <StartBadgeContent badge={badge} color={colors.text} />
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 shrink-0 text-current hover:bg-black/5"
                  aria-label={`${badge.label} löschen`}
                  onClick={() => {
                    if (editingId === badge.id) setEditingId(null);
                    onChange(current => current.filter(item => item.id !== badge.id));
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
          <div className="grid gap-2">
            <Label>Icon</Label>
            <p className="text-xs text-muted-foreground">Übernimmt die Textfarbe des Badges. Standard links vom Text.</p>
            <IconPicker
              value={resolveBadgeIcon(editing.icon)}
              color={readableOnWhite(resolveBadgeColors(editing, fallbackTextColor, brandColor).text)}
              allowEmpty
              emptyLabel="Kein Icon"
              onChange={icon => patch(editing.id, { icon })}
            />
            {resolveBadgeIcon(editing.icon) ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 justify-start gap-2 bg-white"
                onClick={() => patch(editing.id, { iconPosition: resolveBadgeIconPosition(editing.iconPosition) === "right" ? "left" : "right" })}
              >
                <ArrowLeftRight className="size-3.5" />
                {resolveBadgeIconPosition(editing.iconPosition) === "right" ? "Icon nach links" : "Icon nach rechts"}
              </Button>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <IconColorField
              label="Hintergrund"
              value={editing.backgroundColor}
              brandColor="#ffffff"
              allowTransparent
              onChange={color => patch(editing.id, { backgroundColor: color })}
            />
            <IconColorField
              label="Textfarbe"
              value={editing.textColor}
              brandColor={resolveBadgeColors({ backgroundColor: editing.backgroundColor }, fallbackTextColor, brandColor).text}
              presetLabel="Automatisch"
              resetLabel="Automatisch verwenden"
              onChange={color => patch(editing.id, { textColor: color })}
            />
            <IconColorField
              label="Randfarbe"
              value={editing.borderColor}
              brandColor={defaultBorderHex(editing, fallbackTextColor, brandColor)}
              presetLabel="Wie Hintergrund"
              resetLabel="Wie Hintergrund verwenden"
              onChange={color => patch(editing.id, { borderColor: color })}
            />
            <div className="grid content-start gap-2">
              <Label htmlFor={`badge-border-width-${editing.id}`}>Randbreite (px)</Label>
              <Input
                id={`badge-border-width-${editing.id}`}
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_BADGE_BORDER_WIDTH}
                step={1}
                className="bg-white"
                value={resolveBadgeBorderWidth(editing.borderWidth)}
                onChange={event => {
                  if (event.target.value === "") return;
                  patch(editing.id, { borderWidth: resolveBadgeBorderWidth(Number(event.target.value)) });
                }}
              />
              <p className="text-xs text-muted-foreground">0 = kein Rand, maximal {MAX_BADGE_BORDER_WIDTH} px.</p>
            </div>
          </div>
        </div>
      ) : null}
      {atLimit ? <p className="text-xs text-muted-foreground">Maximal {MAX_START_BADGES} Badges.</p> : null}
    </div>
  );
}

/** Hex shown in the outline picker while it follows the fill. */
function defaultBorderHex(badge: StartBadge, fallbackTextColor: string, brandColor: string): string {
  const colors = resolveBadgeColors(badge, fallbackTextColor, brandColor);
  const border = resolveBadgeBorderColor({ backgroundColor: badge.backgroundColor }, colors.text, "#E2E5EA");
  return border.startsWith("#") ? border : colors.text;
}

/** Icon tiles in the picker are white; light badge text is shown dark there so the icons stay visible. */
function readableOnWhite(color: string): string {
  return isLightColor(color) ? "#10253F" : color;
}
