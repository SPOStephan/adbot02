import { useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { ADBOT_FUNNEL_ICONS, FUNNEL_OPTION_ICON_LABELS, FUNNEL_OPTION_ICONS, LUCIDE_FUNNEL_ICONS, isAdbotFunnelIcon } from "@shared/funnel";
import type { FunnelOptionIcon } from "@shared/funnel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FunnelIcon } from "@/components/funnel/FunnelIcon";
import { getNextIconGridIndex, isIconActivationKey } from "@/lib/iconKeyboard";

type IconSource = "all" | "lucide" | "adbot";

export function IconPicker({
  value,
  onChange,
  color,
}: {
  value: FunnelOptionIcon;
  onChange: (value: FunnelOptionIcon) => void;
  color?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<IconSource>("all");
  const iconButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const normalizedSearch = search.trim().toLocaleLowerCase("de");
  const catalog = source === "adbot" ? ADBOT_FUNNEL_ICONS : source === "lucide" ? LUCIDE_FUNNEL_ICONS : FUNNEL_OPTION_ICONS;
  const filteredIcons = catalog.filter(icon => `${FUNNEL_OPTION_ICON_LABELS[icon]} ${icon}`.toLocaleLowerCase("de").includes(normalizedSearch));
  const selectIcon = (icon: FunnelOptionIcon) => { onChange(icon); setOpen(false); };
  const handleIconKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number, icon: FunnelOptionIcon) => {
    if (isIconActivationKey(event.key)) {
      event.preventDefault();
      selectIcon(icon);
      return;
    }
    const grid = event.currentTarget.parentElement;
    const columnCount = grid ? window.getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length : 3;
    const nextIndex = getNextIconGridIndex({ currentIndex: index, key: event.key, itemCount: filteredIcons.length, columnCount });
    if (nextIndex === null || nextIndex === index) return;
    event.preventDefault();
    iconButtonRefs.current[nextIndex]?.focus();
  };
  const swatch = color || "#0165c3";

  return (
    <Popover open={open} onOpenChange={next => { setOpen(next); if (!next) { setSearch(""); setSource("all"); } }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-9 min-w-0 justify-between gap-2 bg-white px-2.5" aria-label={`Icon auswählen, aktuell ${FUNNEL_OPTION_ICON_LABELS[value]}`}>
          <span className="flex min-w-0 items-center gap-2">
            <FunnelIcon name={value} className="size-4 shrink-0" color={swatch} />
            <span className="truncate text-xs">{FUNNEL_OPTION_ICON_LABELS[value]}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,430px)] p-3">
        <div className="mb-3">
          <p className="font-semibold">Icon auswählen</p>
          <p className="text-xs text-muted-foreground">Lucide-Stil plus eigene Adbot-Bibliothek. Klick genügt.</p>
        </div>
        <div className="mb-3 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
          {([
            ["all", "Alle"],
            ["lucide", "Lucide"],
            ["adbot", "Adbot"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`rounded-md px-2 py-1.5 text-xs font-semibold ${source === id ? "bg-white shadow-sm" : "text-muted-foreground"}`}
              onClick={() => setSource(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input autoFocus className="pl-9" value={search} placeholder="Icon suchen …" aria-label="Icons durchsuchen" onChange={event => setSearch(event.target.value)} />
        </div>
        <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4" role="group" aria-label="Verfügbare Icons">
          {filteredIcons.map((icon, index) => (
            <button
              key={icon}
              ref={element => { iconButtonRefs.current[index] = element; }}
              type="button"
              aria-label={`${FUNNEL_OPTION_ICON_LABELS[icon]} auswählen`}
              aria-pressed={value === icon}
              title={isAdbotFunnelIcon(icon) ? `Adbot: ${FUNNEL_OPTION_ICON_LABELS[icon]}` : FUNNEL_OPTION_ICON_LABELS[icon]}
              onClick={() => selectIcon(icon)}
              onKeyDown={event => handleIconKeyDown(event, index, icon)}
              className={`grid min-h-20 place-items-center gap-1 rounded-xl border p-2 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0165c3] ${value === icon ? "border-[#0165c3] bg-[#0165c3]/10 text-[#0165c3] shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-[#0165c3]/40 hover:bg-slate-50"}`}
            >
              <FunnelIcon name={icon} className="size-6" color={swatch} />
              <span className="line-clamp-2 text-[10px] font-semibold leading-tight">{FUNNEL_OPTION_ICON_LABELS[icon]}</span>
            </button>
          ))}
        </div>
        {filteredIcons.length === 0 && <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-sm text-muted-foreground">Kein passendes Icon gefunden.</p>}
      </PopoverContent>
    </Popover>
  );
}
