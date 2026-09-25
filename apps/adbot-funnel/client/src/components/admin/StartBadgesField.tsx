import { Trash2 } from "lucide-react";
import type { StartBadge } from "@shared/funnel";
import { badgeFromTemplate, emptyStartBadge, MAX_START_BADGES, START_BADGE_TEMPLATES } from "@shared/startLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IconColorField } from "@/components/admin/IconColorField";

export function StartBadgesField({
  badges,
  brandColor,
  onChange,
}: {
  badges: StartBadge[];
  brandColor: string;
  onChange: (badges: StartBadge[]) => void;
}) {
  const atLimit = badges.length >= MAX_START_BADGES;
  const add = (badge: StartBadge) => {
    if (atLimit) return;
    onChange([...badges, badge]);
  };

  return (
    <div className="grid gap-3 rounded-xl border bg-slate-50 p-3">
      <div>
        <p className="text-sm font-bold">Badges (optional)</p>
        <p className="text-xs text-muted-foreground">Kleine Chips unter der Überschrift, zum Beispiel „Homeoffice“ oder „10.000 €“. Vorlagen einsetzen oder frei tippen.</p>
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
        <Label>Eigene Badges</Label>
        <Button size="sm" variant="outline" disabled={atLimit} onClick={() => add(emptyStartBadge())}>
          Badge hinzufügen
        </Button>
      </div>
      {badges.map((badge, index) => (
        <div className="grid gap-3 rounded-xl border bg-white p-3" key={badge.id}>
          <div className="flex items-center gap-2">
            <Input
              value={badge.label}
              maxLength={80}
              onChange={event => onChange(badges.map(item => item.id === badge.id ? { ...item, label: event.target.value } : item))}
            />
            <Button
              size="icon"
              variant="ghost"
              className="shrink-0 text-destructive"
              aria-label={`Badge ${badge.label} löschen`}
              onClick={() => onChange(badges.filter((_, itemIndex) => itemIndex !== index))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <IconColorField
              label="Hintergrund"
              value={badge.backgroundColor}
              brandColor="#ffffff"
              onChange={color => onChange(badges.map(item => item.id === badge.id ? { ...item, backgroundColor: color } : item))}
            />
            <IconColorField
              label="Textfarbe"
              value={badge.textColor}
              brandColor={brandColor}
              onChange={color => onChange(badges.map(item => item.id === badge.id ? { ...item, textColor: color } : item))}
            />
          </div>
        </div>
      ))}
      {atLimit ? <p className="text-xs text-muted-foreground">Maximal {MAX_START_BADGES} Badges.</p> : null}
    </div>
  );
}
