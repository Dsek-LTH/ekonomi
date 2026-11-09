"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { type Column } from "@/components/ui/data-table";
import { ClientDataTable } from "@/components/ui/client-data-table";
import { IconButton } from "@/components/ui/icon-button";
import { Button, ButtonLink } from "@/components/ui/button";
import { Menu, MenuItem, MenuLabel, MenuNote, MenuSeparator } from "@/components/ui/menu";
import { useTableControls } from "@/lib/data/use-list-query";
import { useRole } from "@/components/shell/role-context";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { useNotify } from "@/components/shell/notifications";
import { PageShell } from "@/components/page-shell";
import { IconCompare, IconCopy, IconPlus, IconTrash, IconUpload } from "@/components/ui/icons";
import { Tag } from "@/components/ui/status-pill";
import { Checkbox } from "@/components/ui/checkbox";
import { isAdmin } from "@/lib/domain/permissions";
import { useProgressRouter } from "@/components/shell/route-progress";
import type { BudgetSummary } from "@/lib/data/budget";

// Budgets are siblings (several may share a year), so the list is flat. Rows arrive from the
// page's Server Component and writes refresh through `useMutation`.
export function BudgetListClient({
  budgets,
  year,
}: {
  /** Every budget, for comparing and copying across years. The table shows only `year`'s. */
  budgets: BudgetSummary[];
  /** The header's räkenskapsår as a calendar year. Null before any year is synced (all listed). */
  year: number | null;
}) {
  const router = useProgressRouter();
  const t = useTranslations("budget.list");
  const { user } = useRole();
  const confirm = useConfirm();
  const admin = isAdmin(user.capabilities);

  const { pending, mutate } = useMutation();
  const notify = useNotify();
  const fileRef = useRef<HTMLInputElement>(null);
  const controls = useTableControls({ sortKey: "year", sortDir: "desc" });

  // Which budgets the compare view opens with: any of them against any other, across years.
  const [picked, setPicked] = useState<string[]>([]);

  // A new budget is for the year being looked at.
  const thisYear = year ?? new Date().getFullYear();
  const shown = year == null ? budgets : budgets.filter((b) => b.year === year);

  // Creating asks nothing: name and year are editable on the budget's own page. `key` names
  // the control that asked, so only that one spins (they share one busy scope).
  async function create(
    body: { year: number; name?: string; copyFromId?: string },
    success: string,
    key = "create",
  ) {
    const data = await mutate<{ id: string }>("/api/budgets", {
      key,
      body,
      error: t("createFailed"),
      success,
    });
    if (data?.id) router.push(`/budget/${data.id}`);
  }

  const createEmpty = () => create({ year: thisYear }, t("created"));

  // A plain copy: the source's year, a derived name, no tie back to the source.
  const copyBudget = (b: BudgetSummary, key?: string) =>
    create(
      { year: b.year, name: t("copyOf", { name: b.name }), copyFromId: b.id },
      t("copied"),
      key,
    );

  // Imports a past budget from the interchange CSV (lib/domain/budget-csv.ts). Asks nothing:
  // the year is the header's (the route holds to it) and the name is the file's.
  async function importCsv(file: File) {
    const base = file.name.replace(/\.[^.]+$/, "");
    const year = thisYear;
    const data = await mutate<{
      budgetId: string;
      sheets: number;
      accounts: number;
      lines: number;
      unmatchedCostCenters: string[];
      problems: { line: number; message: string }[];
    }>(`/api/budgets/import?year=${year}&name=${encodeURIComponent(base)}`, {
      key: "import",
      body: file,
      contentType: "text/csv",
      error: t("importFailed"),
    });
    if (fileRef.current) fileRef.current.value = "";
    if (!data) return;

    notify.success(
      t("imported", { sheets: data.sheets, accounts: data.accounts, lines: data.lines }),
    );
    // Neither stops the import but neither may pass silently: a sheet with no cost centre is
    // left out of the Utfall comparison (lib/ledger/comparison.ts), and a dropped row is
    // missing from the budget.
    if (data.unmatchedCostCenters.length > 0) {
      notify.info(
        t("importUnmatched", {
          count: data.unmatchedCostCenters.length,
          codes: data.unmatchedCostCenters.join(", "),
        }),
      );
    }
    if (data.problems.length > 0) {
      notify.info(
        t("importProblems", {
          count: data.problems.length,
          first: `${data.problems[0].line}: ${data.problems[0].message}`,
        }),
      );
    }
    router.push(`/budget/${data.budgetId}`);
  }

  async function deleteBudget(b: BudgetSummary) {
    const ok = await confirm({
      title: t("deleteTitle", { year: b.year, name: b.name }),
      message: t("deleteMessage"),
      confirmLabel: t("delete"),
      tone: "danger",
    });
    if (!ok) return;
    await mutate(`/api/budgets/${b.id}`, {
      key: b.id,
      method: "DELETE",
      success: t("deleted"),
      error: t("deleteFailed"),
    });
    setPicked((p) => p.filter((id) => id !== b.id));
  }

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const columns: Column<BudgetSummary>[] = [
    {
      key: "compare",
      header: "",
      className: "w-10 align-middle",
      // On a phone it rides with the buttons at the foot of the card (no checkbox column).
      mobile: "actions",
      cell: (b) => (
        // `z-10`: the row is a link whose `before:` overlay DataTable stretches over the row,
        // and this cell is earlier in tree order, so without it ticking opened the budget.
        <Checkbox
          className="z-10"
          checked={picked.includes(b.id)}
          onChange={() => toggle(b.id)}
          label={t("compareAria", { year: b.year, name: b.name })}
        />
      ),
    },
    {
      key: "year",
      mobile: "meta",
      header: t("colYear"),
      value: (b) => b.year,
      sortable: true,
      searchable: true,
      className: "w-24 whitespace-nowrap",
      cell: (b) => <span className="text-sm font-medium tabular-nums">{b.year}</span>,
    },
    {
      // Sortable and searchable on the date itself ("2026-04" narrows to a month). A draft sorts
      // as the empty string.
      key: "adoptedAt",
      mobile: "meta",
      header: t("colAdopted"),
      value: (b) => b.adoptedAt ?? "",
      sortable: true,
      searchable: true,
      className: "w-32 whitespace-nowrap",
      cell: (b) =>
        b.adoptedAt ? (
          <span className="text-sm tabular-nums text-muted">{b.adoptedAt}</span>
        ) : (
          <span className="text-sm text-muted">{t("notAdopted")}</span>
        ),
    },
    {
      key: "name",
      header: t("colBudget"),
      value: (b) => b.name,
      sortable: true,
      searchable: true,
      mobile: "title",
      cell: (b) => (
        <p className="flex items-center gap-2 truncate text-sm font-medium">
          {b.name}
          {b.lockedAt && (
            <Tag tone="purple" size="sm">
              {t("locked")}
            </Tag>
          )}
        </p>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      mobile: "actions",
      className: "whitespace-nowrap",
      cell: (b) => (
        <div className="relative flex items-center justify-end gap-2">
          {admin && (
            <>
              <IconButton
                label={t("copy")}
                onClick={() => copyBudget(b, `copy-${b.id}`)}
                loading={pending === `copy-${b.id}`}
              >
                <IconCopy className="size-4" />
              </IconButton>
              <IconButton
                label={t("deleteBudget")}
                tone="danger"
                onClick={() => deleteBudget(b)}
                loading={pending === b.id}
                disabled={b.lockedAt !== null}
              >
                <IconTrash className="size-4" />
              </IconButton>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <PageShell title={t("title")}>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importCsv(f);
        }}
      />
      <Card>
        <ClientDataTable
          columns={columns}
          rows={shown}
          controls={controls}
          action={
            <div className="flex items-center gap-2">
              <span className="flex" data-tour="budget-compare">
                {picked.length >= 2 ? (
                  <ButtonLink
                    variant="secondary"
                    size="sm"
                    href={`/budget/compare?b=${picked.join(",")}`}
                  >
                    <IconCompare className="size-4" />
                    {t("compareCount", { count: picked.length })}
                  </ButtonLink>
                ) : (
                  <Button variant="secondary" size="sm" disabled title={t("compareHint")}>
                    <IconCompare className="size-4" />
                    {t("compare")}
                  </Button>
                )}
              </span>
              {admin && (
                <span className="flex" data-tour="budget-new">
                  <Menu
                    label={t("new")}
                    icon={<IconPlus className="size-4" />}
                    loading={pending === "create"}
                  >
                    <MenuItem onClick={createEmpty}>
                      {t("newEmpty", { year: String(thisYear) })}
                    </MenuItem>
                    {budgets.length > 0 && (
                      <>
                        <MenuSeparator />
                        <MenuLabel>{t("copyExisting")}</MenuLabel>
                        {budgets.map((b) => (
                          <MenuItem key={b.id} onClick={() => copyBudget(b)}>
                            <span className="tabular-nums text-muted">{b.year}</span>
                            <span className="truncate">{b.name}</span>
                          </MenuItem>
                        ))}
                        <MenuNote>{t("basedOnHint")}</MenuNote>
                      </>
                    )}
                    <MenuSeparator />
                    <MenuItem onClick={() => fileRef.current?.click()}>
                      <IconUpload className="size-4" />
                      {t("importCsv")}
                    </MenuItem>
                    <MenuNote>{t("importHint")}</MenuNote>
                  </Menu>
                </span>
              )}
            </div>
          }
          searchPlaceholder={t("searchPlaceholder")}
          rowKey={(b) => b.id}
          rowHref={(b) => `/budget/${b.id}`}
          empty={
            budgets.length === 0
              ? t("emptyNone")
              : shown.length === 0
                ? t("emptyYear", { year: String(thisYear) })
                : t("emptyNoMatch")
          }
        />
      </Card>
    </PageShell>
  );
}
