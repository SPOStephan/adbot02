import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ColorValueEditor } from "@/components/admin/ColorValueEditor";

export function IconColorField({
  label,
  value,
  brandColor,
  onChange,
  presetLabel = "Brandingfarbe",
  resetLabel = "Branding verwenden",
}: {
  label: string;
  value?: string;
  brandColor: string;
  onChange: (value: string | undefined) => void;
  presetLabel?: string;
  resetLabel?: string;
}) {
  const resolved = value || brandColor;
  const usingBrand = !value;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {usingBrand
          ? <span className="text-[11px] font-medium text-muted-foreground">{presetLabel}</span>
          : <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => onChange(undefined)}>{resetLabel}</Button>}
      </div>
      <div className="rounded-xl border bg-white p-2">
        <ColorValueEditor value={resolved} onChange={onChange} ariaLabel={label} />
      </div>
    </div>
  );
}
