import { Loader2, RefreshCw } from "lucide-react";
import { formatBerlinDateTime } from "@shared/berlinTime";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STATUS_LABELS = {
  sent: { label: "Gesendet", className: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  failed: { label: "Fehlgeschlagen", className: "bg-rose-50 text-rose-800 border-rose-200" },
  skipped: { label: "Nicht gesendet", className: "bg-amber-50 text-amber-800 border-amber-200" },
} as const;

function formatTime(value: string) {
  return formatBerlinDateTime(value, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Versandprotokoll der Funnel-E-Mails; nur für freigegebene Konten sichtbar (serverseitig geprüft). */
export function MailLogSection() {
  const accessQuery = trpc.mailLog.access.useQuery();
  const canView = accessQuery.data?.canView === true;
  const logQuery = trpc.mailLog.list.useQuery({ limit: 200 }, { enabled: canView, refetchOnWindowFocus: false });

  if (!canView) return null;
  const entries = logQuery.data ?? [];

  return (
    <section className="space-y-4 rounded-2xl border bg-white p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">E-Mail-Versandprotokoll</h2>
          <p className="text-sm text-muted-foreground">
            Jede Benachrichtigung über neue Einsendungen, mit Zeitpunkt, Empfängern und Status. Nur für dein Konto sichtbar.
          </p>
        </div>
        <Button onClick={() => void logQuery.refetch()} size="sm" type="button" variant="outline" disabled={logQuery.isFetching}>
          {logQuery.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Aktualisieren
        </Button>
      </div>
      {logQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Wird geladen …</p>
      ) : logQuery.error ? (
        <p className="text-sm text-rose-700">{logQuery.error.message}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch keine E-Mails protokolliert.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Zeitpunkt</TableHead>
              <TableHead>Funnel</TableHead>
              <TableHead>Empfänger</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map(entry => {
              const status = STATUS_LABELS[entry.status] ?? STATUS_LABELS.failed;
              return (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap align-top">{formatTime(entry.createdAt)}</TableCell>
                  <TableCell className="align-top">
                    <div className="font-medium">{entry.funnelTitle || "—"}</div>
                    <div className="max-w-xs truncate text-xs text-muted-foreground" title={entry.subject}>{entry.subject}</div>
                  </TableCell>
                  <TableCell className="align-top text-sm">
                    {entry.recipients.length > 0 ? entry.recipients.map(email => <div key={email}>{email}</div>) : "—"}
                  </TableCell>
                  <TableCell className="align-top">
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
                    {entry.error && <div className="mt-1 max-w-xs break-words text-xs text-rose-700">{entry.error}</div>}
                    {entry.providerMessageId && <div className="mt-1 font-mono text-[11px] text-muted-foreground" title="Resend-ID">{entry.providerMessageId}</div>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
