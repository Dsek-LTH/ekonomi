"use client";

// Uthyrning → Utrustning. The gear the section lets out, what there is of it,
// and what it costs to replace.
//
// The replacement value is why this screen exists. It is the figure the
// liability clause of an uthyrningsavtal points at, and before there was a
// catalogue it was whatever the person drawing the contract remembered, so the
// same speaker went out at three different values. The quantity is why the
// screen earns its keep twice: it is what availability is measured against, so
// a wrong count here is a Soundboks promised to two people.
//
// A table rather than a list of label-and-value rows, because the point of
// having them all on one screen is comparing them, and nothing compares when
// the numbers do not line up. Editing is a dialog: see item-dialog.tsx.
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Amount } from "@/components/ui/amount";
import { IconPlus } from "@/components/ui/icons";
import { ClientDataTable } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { useTableControls } from "@/lib/data/use-list-query";
import { oreToSEK } from "@/lib/domain/money";
import { ItemDialog } from "./item-dialog";
import type { RentalItemRow } from "@/lib/data/rental-items";

export function RentalItemsClient({ items }: { items: RentalItemRow[] }) {
  const t = useTranslations("contracts.items");

  // Null means the dialog is closed; an item means edit; the "new" sentinel
  // means add. Three states in one value, because they are one dialog and
  // separate flags could disagree about which.
  const [editing, setEditing] = useState<RentalItemRow | "new" | null>(null);

  // The whole catalogue is on the page, so the table filters and sorts in the
  // browser. Fifteen rows, not fifteen thousand.
  const controls = useTableControls({ sortKey: "name" });

  const columns: Column<RentalItemRow>[] = useMemo(
    () => [
      {
        key: "name",
        header: t("name"),
        mobile: "title",
        value: (i) => i.name,
        sortable: true,
        searchable: true,
        cell: (i) => (
          <span>
            <span className="flex flex-wrap items-center gap-2">
              {/* The name is the control. DataTable rows are links, not
                  buttons, and this one has to open a dialog rather than
                  navigate, so the affordance sits on the words somebody would
                  aim at anyway. That is one target per row instead of a pencil
                  column repeating "editable" fifteen times. */}
              <button
                type="button"
                onClick={() => setEditing(i)}
                className="text-left font-medium text-accent underline decoration-faint underline-offset-2 hover:decoration-current"
              >
                {i.name}
              </button>
            </span>
            {i.description && (
              <span className="block truncate text-xs text-muted">{i.description}</span>
            )}
          </span>
        ),
      },
      {
        key: "quantity",
        header: t("quantity"),
        align: "right",
        mobile: "meta",
        value: (i) => i.quantity,
        sortable: true,
        cell: (i) => <span className="tabular-nums">{i.quantity}</span>,
      },
      {
        key: "dailyPrice",
        header: t("dailyPrice"),
        align: "right",
        mobile: "hide",
        value: (i) => i.dailyPriceOre ?? -1,
        sortable: true,
        // A dash, not "0,00 kr": no standing price and free of charge are
        // different answers, and the contract prints them differently.
        cell: (i) =>
          i.dailyPriceOre === null ? (
            <span className="text-muted">-</span>
          ) : (
            <Amount value={oreToSEK(i.dailyPriceOre)} />
          ),
      },
      {
        key: "replacementValue",
        header: t("replacementValue"),
        align: "right",
        mobile: "trailing",
        value: (i) => i.replacementValueOre,
        sortable: true,
        cell: (i) => <Amount value={oreToSEK(i.replacementValueOre)} />,
      },
      {
        key: "usedBy",
        header: t("usedByColumn"),
        align: "right",
        mobile: "hide",
        value: (i) => i.usedBy,
        sortable: true,
        cell: (i) =>
          i.usedBy === 0 ? (
            <span className="text-muted">-</span>
          ) : (
            <span className="tabular-nums text-muted">{i.usedBy}</span>
          ),
      },
    ],
    [t],
  );

  const add = (
    <Button size="sm" variant="accentOutline" onClick={() => setEditing("new")}>
      <IconPlus className="size-4" />
      {t("add")}
    </Button>
  );

  return (
    <>
      <Card>
        <ClientDataTable
          columns={columns}
          rows={items}
          controls={controls}
          action={add}
          searchPlaceholder={t("searchPlaceholder")}
          rowKey={(i) => i.id}
          empty={items.length === 0 ? t("empty") : t("noMatch")}
        />
      </Card>

      {editing !== null && (
        <ItemDialog
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
