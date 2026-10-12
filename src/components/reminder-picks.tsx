"use client";

// Ticking rows on a list to remind somebody about them: the box on each row,
// the select-all over them, the "Påminn (n)" button on the toolbar, and the
// dialog it opens. The same on every list that offers it (Utlägg, Attest, and
// the bank feed), so each one says only which rows can be ticked and what they
// are.
//
// The ticks are for the rows on screen. Paging or filtering leaves behind the
// boxes it hides, rather than reminding somebody about a row nobody can see
// any more.
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
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
  /** For the toolbar. Null until something is ticked. */
  button: React.ReactNode;
  /** Render it anywhere on the page. Null while closed. */
  dialog: React.ReactNode;
} {
  const t = useTranslations("expenses.reminders");
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  // The callers' functions are written inline, so they are new on every
  // render. The rows are what actually changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const choosable = useMemo(() => (enabled ? rows.filter(remindable).map(rowId) : []), [enabled, rows]);
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
      // With the buttons at the foot of the card on a phone, as the budget
      // list's compare box is: there is no checkbox column there to put it in.
      mobile: "actions",
      cell: (row: T) => {
        const id = rowId(row);
        return choosable.includes(id) ? (
          // `z-10` to sit above the row's link, which DataTable stretches over
          // the whole row from the title cell. This cell comes before that one,
          // so without it ticking the box opened the row instead. See the
          // compare column in app/(app)/budget/budget-list-client.tsx.
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
    // Only once something is ticked: an inert "Påminn (0)" on every visit
    // would be a button for a question nobody asked.
    button:
      ticked.length > 0 ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {t("remindPicked", { count: ticked.length })}
        </Button>
      ) : null,
    dialog: open ? (
      <ReminderDialog
        {...(subject === "expense" ? { expenseIds: ticked } : { transactionIds: ticked })}
        onClose={() => setOpen(false)}
        onSent={() => setPicked([])}
      />
    ) : null,
  };
}

/**
 * A box in the middle of its cell, both ways. The checkbox is an inline-flex
 * label, so on its own it sits on the line's text baseline, with the room
 * under it a descender would take, and lands visibly above the middle of a
 * row whose other cells are centred. A block-level flex row is no line of
 * text, so there is no baseline to sit on.
 */
function Centred({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-center">{children}</div>;
}
