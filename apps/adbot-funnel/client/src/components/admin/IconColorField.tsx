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
  allowTransparent = false,
}: {
  label: string;
  value?: string;
  brandColor: string;
  onChange: (value: string | undefined) => void;
  presetLabel?: string;
  resetLabel?: string;
  /** Offers "transparent" as a value (stored literally); the color editor is hidden while it is active. */
  allowTransparent?: boolean;
}) {
  const transparent = allowTransparent && value === "transparent";
  const resolved = transparent ? brandColor : value || brandColor;
  const usingBrand = !value;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {usingBrand
          ? <span className="text-[11px] font-medium text-muted-foreground">{presetLabel}</span>
          : <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => onChange(undefined)}>{resetLabel}</Button>}
      </div>
      {transparent ? (
        <div
          className="flex h-10 items-center justify-center rounded-xl border text-xs font-semibold text-muted-foreground"
          style={{ backgroundImage: "repeating-conic-gradient(#e2e8f0 0% 25%, #ffffff 0% 50%)", backgroundSize: "12px 12px" }}
        >
          Transparent
        </div>
      ) : (
        <div className="rounded-xl border bg-white p-2">
          <ColorValueEditor value={resolved} onChange={onChange} ariaLabel={label} />
        </div>
      )}
      {allowTransparent ? (
        <Button
          type="button"
          size="sm"
          variant={transparent ? "secondary" : "outline"}
          className="h-8 bg-white text-xs"
          aria-pressed={transparent}
          onClick={() => onChange(transparent ? undefined : "transparent")}
        >
          {transparent ? "Farbe statt transparent" : "Transparent"}
        </Button>
      ) : null}
    </div>
  );
}
