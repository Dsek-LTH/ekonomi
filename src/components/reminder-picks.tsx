"use client";

// Ticking rows on a list to remind somebody: row boxes, select-all, the "Påminn" bar and its dialog. The same
// on every list that offers it. Ticks are for the rows on screen; paging or filtering leaves hidden boxes behind.
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { SelectionBar } from "@/components/selection-bar";
import { Checkbox } from "@/components/ui/checkbox";
import type { Column } from "@/components/ui/data-table";
import { ReminderDialog } from "@/components/reminder-dialog";
import type { ReminderSubject } from "@/lib/domain/reminders";

export function useReminderPicks<T>({
  rows,
  enabled,
  subject,
  rowId,
  remindable,
  rowLabel,
}: {
  rows: readonly T[];
  /** Holds SEND_REMINDERS. Without it there is no column and no button. */
  enabled: boolean;
  subject: ReminderSubject;
  rowId: (row: T) => string;
  /** Whether this row gets a box. See lib/domain/reminders.ts for the rules. */
  remindable: (row: T) => boolean;
  /** What the box is called to a screen reader: the row's name. */
  rowLabel: (row: T) => string;
}): {
  /** Hidden when not `enabled`, so it can sit first in any list's columns. */
  column: Column<T>;
  /** The bar at the foot of the screen while something is ticked. Render it
   *  anywhere on the page: it portals itself. */
  bar: React.ReactNode;
  /** Render it anywhere on the page. Null while closed. */
  dialog: React.ReactNode;
} {
  const t = useTranslations("expenses.reminders");
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  // The callers' functions are inline, so new on every render. The rows are what changes.
  const choosable = useMemo(
    () => (enabled ? rows.filter(remindable).map(rowId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, rows],
  );
  const ticked = useMemo(() => picked.filter((id) => choosable.includes(id)), [picked, choosable]);

  const column = useMemo<Column<T>>(
    () => ({
      key: "remind",
      header: (
        <Centred>
          <Checkbox
            checked={choosable.length > 0 && ticked.length === choosable.length}
            indeterminate={ticked.length > 0 && ticked.length < choosable.length}
            onChange={() => setPicked(ticked.length === choosable.length ? [] : choosable)}
            label={t("pickAll")}
          />
        </Centred>
      ),
      className: "w-10 align-middle",
      hidden: !enabled,
      // With the buttons at the foot of the card on a phone: there is no checkbox column there.
      mobile: "actions",
      cell: (row: T) => {
        const id = rowId(row);
        return choosable.includes(id) ? (
          // `z-10` to sit above the row's link, which DataTable stretches over the whole row (see budget-list-client.tsx).
          <Centred>
            <Checkbox
              className="z-10"
              checked={ticked.includes(id)}
              onChange={() =>
                setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
              }
              label={t("pick", { label: rowLabel(row) })}
            />
          </Centred>
        ) : null;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, choosable, ticked, t],
  );

  return {
    column,
    // Only while something is ticked. See SelectionBar.
    bar: (
      <SelectionBar count={ticked.length} label={(count) => t("picked", { count })}>
        <Button variant="quiet" onClick={() => setPicked([])}>
          {t("clearPicked")}
        </Button>
        <Button onClick={() => setOpen(true)}>{t("remindPicked")}</Button>
      </SelectionBar>
    ),
    dialog: open ? (
      <ReminderDialog
        {...(subject === "expense" ? { expenseIds: ticked } : { transactionIds: ticked })}
        onClose={() => setOpen(false)}
        onSent={() => setPicked([])}
      />
    ) : null,
  };
}

/** A box centred in its cell both ways. A block-level flex row has no text baseline to sit on. */
function Centred({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-center">{children}</div>;
}
