import { useState, type MouseEvent } from "react";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { APPLICATION_TRASH_RETENTION_DAYS } from "@shared/applicationTrash";
import { trpc } from "@/lib/trpc";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

function useInvalidateApplications() {
  const utils = trpc.useUtils();
  return () => Promise.all([
    utils.funnel.applications.invalidate(),
    utils.funnel.trashedApplications.invalidate(),
    utils.funnel.application.invalidate(),
    utils.funnel.funnels.invalidate(),
  ]);
}

export function useRestoreApplication() {
  const invalidate = useInvalidateApplications();
  return trpc.funnel.restoreApplication.useMutation({
    onSuccess: async () => {
      await invalidate();
      toast.success("Eintrag wiederhergestellt");
    },
    onError: error => toast.error(error.message),
  });
}

export function formatPurgeDate(purgeAt: string) {
  return new Date(purgeAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Trash-can button with a confirmation step. Deleted entries move to the trash
 * and stay restorable for the retention period before they are removed.
 */
export function DeleteApplicationButton({
  applicationId,
  personLabel,
  variant = "icon",
  onDeleted,
}: {
  applicationId: string;
  personLabel: string;
  variant?: "icon" | "button";
  onDeleted?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const invalidate = useInvalidateApplications();
  const restore = useRestoreApplication();
  const remove = trpc.funnel.deleteApplication.useMutation({
    onSuccess: async result => {
      setOpen(false);
      await invalidate();
      onDeleted?.();
      toast.success("Eintrag in den Papierkorb verschoben", {
        description: `Wird am ${formatPurgeDate(result.purgeAt)} endgültig gelöscht.`,
        action: { label: "Rückgängig", onClick: () => restore.mutate({ id: result.id }) },
      });
    },
    onError: error => toast.error(error.message),
  });
  const openDialog = (event: MouseEvent) => {
    event.stopPropagation();
    setOpen(true);
  };

  return (
    <>
      {variant === "icon" ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:bg-rose-50 hover:text-rose-700"
          aria-label={`Eintrag von ${personLabel} löschen`}
          title="Löschen"
          onClick={openDialog}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      ) : (
        <Button type="button" variant="outline" className="bg-white text-rose-700 hover:bg-rose-50 hover:text-rose-800" onClick={openDialog}>
          <Trash2 className="size-4" aria-hidden="true" />
          Löschen
        </Button>
      )}
      <AlertDialog open={open} onOpenChange={next => !remove.isPending && setOpen(next)}>
        <AlertDialogContent onClick={event => event.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Eintrag löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Der Eintrag von {personLabel} wird in den Papierkorb verschoben und nach {APPLICATION_TRASH_RETENTION_DAYS} Tagen
              endgültig gelöscht, samt hochgeladenem Lebenslauf. Bis dahin kannst du ihn im Papierkorb wiederherstellen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={remove.isPending}
              onClick={event => {
                event.preventDefault();
                remove.mutate({ id: applicationId });
              }}
            >
              {remove.isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {remove.isPending ? "Wird gelöscht …" : "In den Papierkorb"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function RestoreApplicationButton({ applicationId }: { applicationId: string }) {
  const restore = useRestoreApplication();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="bg-white"
      disabled={restore.isPending}
      aria-busy={restore.isPending}
      onClick={event => {
        event.stopPropagation();
        restore.mutate({ id: applicationId });
      }}
    >
      {restore.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />}
      Wiederherstellen
    </Button>
  );
}
