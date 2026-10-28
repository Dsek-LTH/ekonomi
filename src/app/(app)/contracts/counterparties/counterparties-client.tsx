"use client";

// Dokument → Motparter. Who the section has signed with before, and what a new
// contract can pick instead of retyping.
//
// The same shape as the rental item catalogue's screen
// (rentals/equipment/rental-items-client.tsx): a table for comparing rows,
// editing as a dialog. See item-dialog.tsx's sibling here, counterparty-dialog.tsx.
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconPlus } from "@/components/ui/icons";
import { ClientDataTable } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { useTableControls } from "@/lib/data/use-list-query";
import { cn } from "@/lib/ui/utils";
import { CounterpartyDialog } from "./counterparty-dialog";
import type { CounterpartyRow } from "@/lib/data/counterparties";

export function CounterpartiesClient({ counterparties }: { counterparties: CounterpartyRow[] }) {
  const t = useTranslations("contracts.counterparties");

  const [editing, setEditing] = useState<CounterpartyRow | "new" | null>(null);
  const controls = useTableControls({ sortKey: "name" });

  const columns: Column<CounterpartyRow>[] = useMemo(
    () => [
      {
        key: "name",
        header: t("name"),
        mobile: "title",
        value: (c) => c.name,
        sortable: true,
        searchable: true,
        cell: (c) => (
          <span>
            <span className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setEditing(c)}
                className={cn(
                  "text-left font-medium text-accent hover:underline",
                )}
              >
                {c.name}
              </button>
            </span>
            {c.city && <span className="block truncate text-xs text-muted">{c.city}</span>}
          </span>
        ),
      },
      {
        key: "orgNo",
        header: t("orgNo"),
        mobile: "meta",
        value: (c) => c.orgNo ?? "",
        sortable: true,
        cell: (c) => c.orgNo ?? <span className="text-muted">-</span>,
      },
      {
        key: "usedBy",
        header: t("usedByColumn"),
        align: "right",
        mobile: "trailing",
        value: (c) => c.usedBy,
        sortable: true,
        cell: (c) =>
          c.usedBy === 0 ? (
            <span className="text-muted">-</span>
          ) : (
            <span className="tabular-nums text-muted">{c.usedBy}</span>
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
      {counterparties.length === 0 ? (
        <EmptyState
          title={t("empty")}
          description={t("emptyDescription")}
          action={<Button onClick={() => setEditing("new")}>{t("add")}</Button>}
        />
      ) : (
        <Card>
          <ClientDataTable
            columns={columns}
            rows={counterparties}
            controls={controls}
            action={add}
            searchPlaceholder={t("searchPlaceholder")}
            rowKey={(c) => c.id}
            empty={t("noMatch")}
          />
        </Card>
      )}

      {editing !== null && (
        <CounterpartyDialog
          counterparty={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
