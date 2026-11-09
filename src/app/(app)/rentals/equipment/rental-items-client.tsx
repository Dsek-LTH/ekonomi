"use client";

// Uthyrning → Utrustning: the gear the section lets out. The replacement value is what an uthyrningsavtal's liability clause
// points at, and the quantity is what availability is measured against. Editing is a dialog: see item-dialog.tsx.
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

  // Null means closed; an item means edit; the "new" sentinel means add.
  const [editing, setEditing] = useState<RentalItemRow | "new" | null>(null);

  // The whole catalogue is on the page, so the table filters and sorts in the browser.
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
              <Button
                variant="link"
                type="button"
                onClick={() => setEditing(i)}
                className="text-left"
              >
                {i.name}
              </Button>
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
        // A dash, not "0,00 kr": no standing price and free of charge print differently on the contract.
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
        <ItemDialog item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
