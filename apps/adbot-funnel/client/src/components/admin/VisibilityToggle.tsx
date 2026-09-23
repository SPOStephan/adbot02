import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export function VisibilityToggle({
  label,
  visible,
  onChange,
}: {
  label: string;
  visible: boolean;
  onChange: (visible: boolean) => void;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className={visible ? "text-slate-500" : "text-slate-400"}
      aria-pressed={!visible}
      aria-label={visible ? `${label} im Funnel ausblenden` : `${label} im Funnel einblenden`}
      title={visible ? "Im Funnel sichtbar" : "Im Funnel ausgeblendet"}
      onClick={() => onChange(!visible)}
    >
      {visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
    </Button>
  );
}
