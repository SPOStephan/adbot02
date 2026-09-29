import { FormEvent, useState } from "react";
import { Copy, KeyRound, Loader2, RefreshCw, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { suggestPassword } from "@/lib/suggestPassword";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBerlinDateTime } from "@shared/berlinTime";
import { MailLogSection } from "@/components/admin/MailLogSection";

type IssuedCredentials = { email: string; password: string };

function formatDate(value: string | null) {
  return value
    ? formatBerlinDateTime(value, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "noch nie";
}

function loginUrl() {
  return `${window.location.origin}/admin`;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Kopiert");
  } catch {
    toast.error("Kopieren nicht möglich. Bitte manuell markieren.");
  }
}

function CredentialsBox({ credentials, onClose }: { credentials: IssuedCredentials; onClose: () => void }) {
  const text = `Login: ${loginUrl()}\nE-Mail: ${credentials.email}\nPasswort: ${credentials.password}`;
  return (
    <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <p className="text-sm font-medium text-emerald-900">
        Zugangsdaten zum Weitergeben. Das Passwort wird nur jetzt angezeigt.
      </p>
      <pre className="whitespace-pre-wrap rounded-lg bg-white p-3 font-mono text-sm">{text}</pre>
      <div className="flex gap-2">
        <Button onClick={() => copyText(text)} size="sm" type="button">
          <Copy className="mr-2 h-4 w-4" /> Kopieren
        </Button>
        <Button onClick={onClose} size="sm" type="button" variant="outline">Schließen</Button>
      </div>
    </div>
  );
}

function OwnerAccount() {
  const utils = trpc.useUtils();
  const membersQuery = trpc.members.list.useQuery();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState(() => suggestPassword());
  const [issued, setIssued] = useState<IssuedCredentials | null>(null);

  const createMutation = trpc.members.create.useMutation({
    onSuccess: member => {
      setIssued({ email: member.email, password });
      setEmail("");
      setName("");
      setPassword(suggestPassword());
      void utils.members.list.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const resetMutation = trpc.members.resetPassword.useMutation({
    onError: error => toast.error(error.message),
  });
  const removeMutation = trpc.members.remove.useMutation({
    onSuccess: () => {
      toast.success("Zugang gelöscht");
      void utils.members.list.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createMutation.mutate({ email, name, password });
  }

  function onReset(id: string, memberEmail: string) {
    const next = suggestPassword();
    if (!window.confirm(`Neues Passwort für ${memberEmail} setzen? Das alte gilt dann nicht mehr.`)) return;
    resetMutation.mutate(
      { id, password: next },
      { onSuccess: () => setIssued({ email: memberEmail, password: next }) },
    );
  }

  function onRemove(id: string, memberEmail: string) {
    if (!window.confirm(`Zugang für ${memberEmail} löschen? Die Person wird sofort abgemeldet.`)) return;
    removeMutation.mutate({ id });
  }

  const members = membersQuery.data ?? [];

  return (
    <div className="space-y-8">
      <section className="space-y-4 rounded-2xl border bg-white p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Weiteren Zugang anlegen</h2>
          <p className="text-sm text-muted-foreground">
            Die Person sieht und bearbeitet alle Funnel, Eingänge und Kampagnen dieses Kontos, wie du. Adbot selbst erreicht sie nicht.
          </p>
        </div>
        {issued ? <CredentialsBox credentials={issued} onClose={() => setIssued(null)} /> : null}
        <form className="grid gap-4 md:grid-cols-2" onSubmit={onCreate}>
          <div className="space-y-2">
            <Label htmlFor="member-email">E-Mail</Label>
            <Input id="member-email" onChange={event => setEmail(event.target.value)} required type="email" value={email} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="member-name">Name (optional)</Label>
            <Input id="member-name" onChange={event => setName(event.target.value)} placeholder="z. B. Firma GmbH" value={name} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="member-password">Passwort (vorgeschlagen, änderbar)</Label>
            <div className="flex gap-2">
              <Input
                className="font-mono"
                id="member-password"
                minLength={12}
                onChange={event => setPassword(event.target.value)}
                required
                value={password}
              />
              <Button aria-label="Neues Passwort vorschlagen" onClick={() => setPassword(suggestPassword())} type="button" variant="outline">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="md:col-span-2">
            <Button disabled={createMutation.isPending} type="submit">
              {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
              Zugang anlegen
            </Button>
          </div>
        </form>
      </section>

      <section className="space-y-4 rounded-2xl border bg-white p-6">
        <h2 className="text-lg font-semibold">Bestehende Zugänge</h2>
        {membersQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Wird geladen …</p>
        ) : membersQuery.error ? (
          <p className="text-sm text-rose-700">{membersQuery.error.message}</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine weiteren Zugänge.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>E-Mail</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Letzte Anmeldung</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map(member => (
                <TableRow key={member.id}>
                  <TableCell className="font-medium">{member.email}</TableCell>
                  <TableCell>{member.name || "—"}</TableCell>
                  <TableCell>{formatDate(member.lastLoginAt)}</TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button onClick={() => onReset(member.id, member.email)} size="sm" type="button" variant="outline">
                      <KeyRound className="mr-2 h-4 w-4" /> Neues Passwort
                    </Button>
                    <Button onClick={() => onRemove(member.id, member.email)} size="sm" type="button" variant="outline">
                      <Trash2 className="mr-2 h-4 w-4" /> Löschen
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

export default function Account() {
  const { user } = useAuth();
  const isOwner = user?.loginMethod === "adbot-sso";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Konto</h1>
        <p className="text-sm text-muted-foreground">
          Angemeldet als {user?.email ?? "—"}
        </p>
      </div>
      {isOwner ? (
        <OwnerAccount />
      ) : (
        <p className="rounded-2xl border bg-white p-6 text-sm text-muted-foreground">
          Weitere Zugänge verwaltet der Konto-Inhaber.
        </p>
      )}
      <MailLogSection />
    </div>
  );
}
