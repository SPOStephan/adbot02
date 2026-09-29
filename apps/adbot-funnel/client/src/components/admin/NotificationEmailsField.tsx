import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { formatNotificationEmails, isValidNotificationEmail, MAX_NOTIFICATION_EMAILS, parseNotificationEmails } from "@shared/notificationEmails";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function rowsFromValue(value: string): string[] {
  const emails = parseNotificationEmails(value);
  return emails.length > 0 ? emails : [""];
}

/**
 * One input per recipient address. The funnel config keeps the recipients as
 * a comma-separated string, so this field only splits and joins that value.
 */
export function NotificationEmailsField({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [rows, setRows] = useState(() => rowsFromValue(value));

  useEffect(() => {
    if (formatNotificationEmails(rows) !== formatNotificationEmails(parseNotificationEmails(value))) {
      setRows(rowsFromValue(value));
    }
    // Only external value changes (load, undo) should reset the rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const update = (next: string[]) => {
    const limited = next.slice(0, MAX_NOTIFICATION_EMAILS);
    setRows(limited.length > 0 ? limited : [""]);
    onChange(formatNotificationEmails(limited));
  };

  const changeRow = (index: number, text: string) => {
    // Pasting "a@x.de, b@y.de" into one field splits it into several rows.
    const pasted = /[,;\s]/.test(text.trim()) ? parseNotificationEmails(text) : [text];
    update([...rows.slice(0, index), ...pasted, ...rows.slice(index + 1)]);
  };

  const atLimit = rows.length >= MAX_NOTIFICATION_EMAILS;

  return (
    <div className="grid gap-2">
      {rows.map((row, index) => {
        const invalid = row.trim() !== "" && !isValidNotificationEmail(row);
        return (
          <div key={index} className="flex items-center gap-2">
            <Input
              id={index === 0 ? id : undefined}
              type="email"
              value={row}
              placeholder={index === 0 ? "anfragen@unternehmen.de" : "weitere@unternehmen.de"}
              aria-invalid={invalid || undefined}
              aria-label={`Empfänger-E-Mail ${index + 1}`}
              onChange={event => changeRow(index, event.target.value)}
            />
            {rows.length > 1 && (
              <Button type="button" variant="ghost" size="icon" aria-label="Adresse entfernen" onClick={() => update(rows.filter((_, rowIndex) => rowIndex !== index))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        );
      })}
      <div>
        <Button type="button" variant="outline" size="sm" disabled={atLimit || rows.some(row => row.trim() === "")} onClick={() => setRows([...rows, ""])}>
          <Plus className="mr-1 h-4 w-4" /> Weitere Adresse
        </Button>
      </div>
    </div>
  );
}
