import { Label } from "@/components/ui/label";
import { ColorValueEditor } from "@/components/admin/ColorValueEditor";

export function BrandColorField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="rounded-xl border bg-white p-2">
        <ColorValueEditor value={value} onChange={onChange} ariaLabel={label} />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
