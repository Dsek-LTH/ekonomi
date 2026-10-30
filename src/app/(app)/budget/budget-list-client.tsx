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

// A budget is a year and a name, and nothing above it. Several may share a year
// The adopted one and whatever was drafted beside it, and they are siblings,
// not versions of each other: no budget knows that another exists. So the list
// is flat, and every row stands on its own.
//
// The rows arrive from the page's Server Component, like every other list in the
// app. This used to fetch them itself, which meant it also owned the loading
// state, rendered its own route skeleton, reloaded by hand after every write,
// and showed the "no budgets yet" empty state when the request had actually
// failed. `useMutation`'s refresh does all of that now, and a failure is the
// route's error boundary rather than a silent empty list.
export function BudgetListClient({
  budgets,
  year,
}: {
  /** Every budget, for the comparison and for copying from: either can reach
   *  across years. The table shows only `year`'s. */
  budgets: BudgetSummary[];
  /** The header's räkenskapsår, as the calendar year a budget is kept in.
   *  Null before any year has been synced, and every budget is listed. */
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

  // Which budgets the compare view opens with. Comparing is a question about two
  // or more budgets, so it is chosen here rather than assumed from the list's
  // order, any of them against any other, across years.
  const [picked, setPicked] = useState<string[]>([]);

  // A new budget is for the year being looked at, which is this one unless the
  // header says otherwise.
  const thisYear = year ?? new Date().getFullYear();
  const shown = year == null ? budgets : budgets.filter((b) => b.year === year);

  // Creating asks nothing. Every budget starts as a year and a name that are
  // both a pencil away on its own page, so a form here would only be collecting
  // what the next screen already lets you change, and the empty one has to be
  // named something before you know what it is anyway.
  //
  // `key` names the control that asked, so only that one spins: the header menu
  // and every row's copy button all end up here, and they share one busy scope.
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

  // Duplicating makes a plain copy: the source's year, a derived name, and no
  // tie back to what it was copied from. It keeps the year rather than guessing
  // at next year's. If the copy is meant for another year, that is one edit on
  // the page it just opened.
  const copyBudget = (b: BudgetSummary, key?: string) =>
    create({ year: b.year, name: t("copyOf", { name: b.name }), copyFromId: b.id }, t("copied"), key);

  // Importing a past budget from the interchange CSV (lib/domain/budget-csv.ts).
  //
  // Asks nothing, like every other way of starting a budget here: the year is
  // the one in the header, as for every new budget (the route holds to it), and
  // the name is the file's own. A past year's budget is imported with that year
  // picked.
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

    notify.success(t("imported", { sheets: data.sheets, accounts: data.accounts, lines: data.lines }));
    // Two things the import cannot decide for the reader, and both change what
    // the budget is worth: a sheet with no cost centre is left out of the Utfall
    // comparison entirely (lib/ledger/comparison.ts), and a dropped row is a
    // figure that is simply not in the budget. Neither is an error, so neither
    // stops the import, but neither may pass silently either.
    if (data.unmatchedCostCenters.length > 0) {
      notify.info(t("importUnmatched", {
        count: data.unmatchedCostCenters.length,
        codes: data.unmatchedCostCenters.join(", "),
      }));
    }
    if (data.problems.length > 0) {
      notify.info(t("importProblems", {
        count: data.problems.length,
        first: `${data.problems[0].line}: ${data.problems[0].message}`,
      }));
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

  const toggle = (id: string) => setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);


  const columns: Column<BudgetSummary>[] = [
    {
      key: "compare",
      header: "",
      className: "w-10 align-middle",
      // On a phone it rides with the buttons at the foot of the card; there is
      // no checkbox column there to put it in.
      mobile: "actions",
      cell: (b) => (
        // `z-10` because the row is a link: DataTable stretches the title
        // cell's `before:` over the whole row, and this cell comes *earlier* in
        // the row than that link, so with both at the auto stacking level the
        // overlay won on tree order, and ticking a budget opened it instead.
        // (The action buttons on other lists sit in the last column, after the
        // link, which is why this only ever bit here.)
        //
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
      // Sortable and searchable on the date itself: "2026-04" narrows to that
      // month's meetings, which is how anyone looking for a particular budget
      // actually remembers it. A draft sorts by the empty string and so lands
      // together with the others that were never adopted.
      key: "adoptedAt",
      mobile: "meta",
      header: t("colAdopted"),
      value: (b) => b.adoptedAt ?? "",
      sortable: true,
      searchable: true,
      className: "w-32 whitespace-nowrap",
      cell: (b) =>
        b.adoptedAt
          ? <span className="text-sm tabular-nums text-muted">{b.adoptedAt}</span>
          : <span className="text-sm text-muted">{t("notAdopted")}</span>,
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
            <Tag tone="purple" size="sm">{t("locked")}</Tag>
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
                // A locked budget stays; the server refuses it either way.
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
        {/* No header of its own: the page's heading already says Budget, and
            the table's footer counts the rows. Comparing rides the table's
            toolbar beside "new", acting on the rows ticked below it. */}
        <ClientDataTable
          columns={columns}
          rows={shown}
          controls={controls}
          // On the list's toolbar: it adds a budget to the list under it.
          action={
            <div className="flex items-center gap-2">
              {/* Said in words. As an icon alone it was a pair of arrows
                  nobody could read as "compare budgets", greyed out until two
                  rows were ticked with nothing saying that ticking them is
                  what it waits for. Two is the fewest that makes a comparison;
                  there is no upper bound, the compare view gives each budget
                  its own column. */}
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
              {admin && (
              // Not a form in a dropdown: two ways to start, each one click.
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
