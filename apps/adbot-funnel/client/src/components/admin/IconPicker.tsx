import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, Search } from "lucide-react";
import { FUNNEL_OPTION_ICON_LABELS } from "@shared/funnel";
import { filterLibraryIcons, filterPickerIcons } from "@shared/funnelIconCatalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FunnelIcon } from "@/components/funnel/FunnelIcon";
import { getNextIconGridIndex, isIconActivationKey } from "@/lib/iconKeyboard";
import { trpc } from "@/lib/trpc";
import { registerFunnelLibraryIcons } from "@shared/funnelIconRuntime";

export function IconPicker({
  value,
  onChange,
  color,
}: {
  value: string;
  onChange: (value: string) => void;
  color?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestLabel, setRequestLabel] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [requestSvg, setRequestSvg] = useState("");
  const [requestError, setRequestError] = useState("");
  const iconButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const libraryQuery = trpc.funnel.libraryIcons.useQuery(undefined, { enabled: open });
  const requestIcon = trpc.funnel.requestLibraryIcon.useMutation();
  const libraryIcons = libraryQuery.data ?? [];

  useEffect(() => {
    if (libraryIcons.length) registerFunnelLibraryIcons(libraryIcons);
  }, [libraryIcons]);

  const builtIn = filterPickerIcons(search);
  const commissioned = filterLibraryIcons(libraryIcons, search);
  const filtered: Array<{ id: string; label: string }> = [
    ...builtIn.map(icon => ({ id: icon, label: FUNNEL_OPTION_ICON_LABELS[icon] })),
    ...commissioned.map(icon => ({ id: icon.id, label: icon.label })),
  ];
  const selectIcon = (icon: string) => { onChange(icon); setOpen(false); };
  const handleIconKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number, icon: string) => {
    if (isIconActivationKey(event.key)) {
      event.preventDefault();
      selectIcon(icon);
      return;
    }
    const grid = event.currentTarget.parentElement;
    const columnCount = grid ? window.getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length : 3;
    const nextIndex = getNextIconGridIndex({ currentIndex: index, key: event.key, itemCount: filtered.length, columnCount });
    if (nextIndex === null || nextIndex === index) return;
    event.preventDefault();
    iconButtonRefs.current[nextIndex]?.focus();
  };
  const swatch = color || "#0165c3";
  const currentLabel = FUNNEL_OPTION_ICON_LABELS[value as keyof typeof FUNNEL_OPTION_ICON_LABELS]
    ?? libraryIcons.find(icon => icon.id === value)?.label
    ?? "Icon";

  async function submitRequest() {
    setRequestError("");
    try {
      const created = await requestIcon.mutateAsync({
        label: requestLabel,
        requestNote,
        svg: requestSvg.trim() || undefined,
      });
      registerFunnelLibraryIcons([created]);
      onChange(created.id);
      setRequestLabel("");
      setRequestNote("");
      setRequestSvg("");
      setRequestOpen(false);
      setOpen(false);
      await libraryQuery.refetch();
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Icon konnte nicht angelegt werden.");
    }
  }

  return (
    <Popover open={open} onOpenChange={next => { setOpen(next); if (!next) { setSearch(""); setRequestOpen(false); } }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-9 min-w-0 justify-between gap-2 bg-white px-2.5" aria-label={`Icon auswählen, aktuell ${currentLabel}`}>
          <span className="flex min-w-0 items-center gap-2">
            <FunnelIcon name={value} className="size-4 shrink-0" color={swatch} fit="picker" />
            <span className="truncate text-xs">{currentLabel}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,430px)] p-3">
        <div className="mb-3">
          <p className="font-semibold">Icon auswählen</p>
          <p className="text-xs text-muted-foreground">Eine Liste, nach Bedeutung durchsuchen. Herkunft spielt keine Rolle.</p>
        </div>
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input autoFocus className="pl-9" value={search} placeholder="Icon suchen …" aria-label="Icons durchsuchen" onChange={event => setSearch(event.target.value)} />
        </div>
        <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4" role="group" aria-label="Verfügbare Icons">
          {filtered.map((icon, index) => (
            <button
              key={icon.id}
              ref={element => { iconButtonRefs.current[index] = element; }}
              type="button"
              aria-label={`${icon.label} auswählen`}
              aria-pressed={value === icon.id}
              title={icon.label}
              onClick={() => selectIcon(icon.id)}
              onKeyDown={event => handleIconKeyDown(event, index, icon.id)}
              className={`grid min-h-20 place-items-center gap-1 rounded-xl border p-2 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0165c3] ${value === icon.id ? "border-[#0165c3] bg-[#0165c3]/10 text-[#0165c3] shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-[#0165c3]/40 hover:bg-slate-50"}`}
            >
              <FunnelIcon name={icon.id} className="size-6" color={swatch} fit="picker" />
              <span className="line-clamp-2 text-[10px] font-semibold leading-tight">{icon.label}</span>
            </button>
          ))}
        </div>
        {filtered.length === 0 && <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-sm text-muted-foreground">Kein passendes Icon gefunden.</p>}
        <div className="mt-3 border-t pt-3">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-bold text-[#0165c3]"
            onClick={() => setRequestOpen(current => !current)}
          >
            <Plus className="size-3.5" />
            Icon fehlt? Neu beauftragen
          </button>
          {requestOpen ? (
            <div className="mt-3 grid gap-2">
              <Input value={requestLabel} placeholder="Name, z. B. Fahrrad" aria-label="Name des neuen Icons" onChange={event => setRequestLabel(event.target.value)} />
              <Input value={requestNote} placeholder="Was soll zu sehen sein?" aria-label="Beschreibung für das neue Icon" onChange={event => setRequestNote(event.target.value)} />
              <textarea
                className="min-h-20 w-full rounded-md border bg-white px-3 py-2 text-xs"
                value={requestSvg}
                placeholder="Optional: SVG einfügen – sonst Platzhalter, später ersetzen"
                aria-label="SVG für das neue Icon"
                onChange={event => setRequestSvg(event.target.value)}
              />
              {requestError ? <p className="text-xs text-destructive">{requestError}</p> : null}
              <Button type="button" size="sm" disabled={requestIcon.isPending || requestLabel.trim().length < 2} onClick={() => void submitRequest()}>
                {requestIcon.isPending ? "Wird angelegt …" : "In die Bibliothek übernehmen"}
              </Button>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
