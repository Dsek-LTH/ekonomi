"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyNote } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { Combobox } from "@/components/ui/combobox";
import { EditableText } from "@/components/ui/editable-text";
import { OverlayScroll } from "@/components/ui/overlay-scroll";
import { SidebarGroupLabel, SidebarItem, SidebarPanel } from "@/components/ui/sidebar-list";
import { useRole } from "@/components/shell/role-context";
import { canChangeLockedBudget, canCommentBudget, canLockBudget, isAdmin as isAdminRole } from "@/lib/domain/permissions";
import { useNotify } from "@/components/shell/notifications";
import { useMutation } from "@/components/shell/use-mutation";
import { PageShell } from "@/components/page-shell";
import { IconButton } from "@/components/ui/icon-button";
import { startRouteProgress } from "@/components/shell/route-progress";
import { IconLock, IconLockOpen } from "@/components/ui/icons";

import { buildGrid, orderedColumns, type BudgetGrid, type ColumnDef } from "@/lib/budget/grid";
import { sheetKey, sheetName } from "@/lib/budget";
import { compareKey } from "@/lib/budget/compare";
import { useFormat } from "@/lib/ui/use-format";
import { useStickyFollow } from "@/lib/ui/use-sticky-follow";
import { cn } from "@/lib/ui/utils";
import type { AccountRecord, CostCenter } from "@/lib/domain/types";
import { CHANGES, RAMBUDGET, VARS, adjustmentRows, ccTotals, changeImpactBySheet, resultUnitLabel, resultUnitOf, fmtSigned, groupByResultUnit } from "./budget-helpers";
import { recomputeBudget } from "./recompute";
import { useBudgetCells } from "./use-budget-cells";
import { useComparison } from "./use-comparison";
import { Rambudget } from "./rambudget";
import { VariablesSheet } from "./variables-sheet";
import { ChangesSheet } from "./changes-sheet";
import { CostCenterSheet } from "./cost-center-sheet";
import { CostCenterHeader } from "./cost-center-header";
import type { Budget, BudgetClip } from "./budget-types";

export default function BudgetClient({
  initialBudget,
  costCenters: allCostCenters,
  accounts,
}: {
  /** Server-rendered first copy; the client owns the budget from here on. */
  initialBudget: Budget;
  costCenters: CostCenter[];
  accounts: AccountRecord[];
}) {
  const { budgetId } = useParams<{ budgetId: string }>();
  const t = useTranslations("budget.sheet");
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tList = useTranslations("budget.list");
  const tAlloc = useTranslations("allocation");
  const tEval = useTranslations("budget.eval");
  const tGroup = useTranslations("budget.group");
  const { user } = useRole();
  const { date } = useFormat();
  const notify = useNotify();
  const { mutate } = useMutation();
  const isAdmin = isAdminRole(user.capabilities);
  const canComment = canCommentBudget(user.capabilities);
  const canLock = canLockBudget(user.capabilities);

  // The budget lives in client state because editing it is a client concern:
  // committing a cell re-evaluates every formula in the browser (see
  // use-budget-cells) rather than waiting on the server. The page hands over
  // the first copy already loaded, so there is nothing to fetch on mount.
  const [budget, setBudget] = useState<Budget>(initialBudget);
  const [selected, setSelected] = useState<string>(RAMBUDGET);
  const [search, setSearch] = useState("");
  const [addCcId, setAddCcId] = useState("");
  // Two header/sidebar actions that reload the whole budget when they land, so
  // each says so on itself rather than leaving the page looking untouched.
  const [locking, setLocking] = useState(false);
  const [addingCc, setAddingCc] = useState(false);

  // What has been copied, held on the page: copying is for moving something from
  // one cost centre to another, and the sheet it was copied from is unmounted
  // the moment the next one is picked. Cleared by nothing: a copy stays on the
  // clipboard until the next one replaces it, as a clipboard does.
  const [clip, setClip] = useState<BudgetClip | null>(null);

  // The cost-centre list stands beside the sheet and follows the page as it is
  // scrolled, and the offset is the hook's, not a `top-*` class.
  const stickyList = useStickyFollow<HTMLElement>();

  // The buffered "+ new variable" name (the cost-centre sheet owns its own drafts).
  const [newVar, setNewVar] = useState("");

  // Year and name are edited here, on the budget itself, rather than in the
  // list. Both are properties of the thing this page is showing, and the list
  // is for finding a budget, not for editing one. The edit state itself belongs
  // to each EditableText.

  // The year's outcome from the ledger, which the reload below deliberately
  // does not ask for again. Held here rather than read off `budget` so that
  // `load`, and everything built on it, does not have to depend on the state
  // it sets.
  const outcome = useRef({
    actuals: initialBudget.actuals,
    actualsSynced: initialBudget.actualsSynced,
    actualsYear: initialBudget.actualsYear,
  });

  // Re-read the budget after a write. Same payload the page server-rendered:
  // GET /api/budgets/[id] and the page share one loader (lib/data/budget.ts),
  // so this replaces state with the identical shape it started from.
  //
  // Bar two things it asks the server not to bother with. The outcome, because
  // no budget edit can change what the ledger reported and gathering it is a
  // group-by over the whole financial year, so the copy already in hand is
  // carried over instead. And the evaluated figures, because this page works
  // those out for every cell it commits anyway (`recomputeBudget`, the same
  // evaluator the server runs); asking for them meant evaluating the budget
  // twice over and sending every line's figure back for the pleasure.
  // Not a `useQuery`: this is a refetch on demand rather than a question the
  // url asks, and it may make a second request depending on the first one's
  // answer. What it does borrow is the staleness guard. Two writes in quick
  // succession are two reloads, and the slower one landing second would put the
  // earlier budget back on screen, undoing the later edit until the next write.
  const reload = useRef(0);
  const load = useCallback(async () => {
    const id = ++reload.current;
    const res = await fetch(`/api/budgets/${budgetId}?actuals=0&evaluated=0`);
    if (!res.ok || id !== reload.current) return;
    const fresh = (await res.json()) as Budget;
    // Unless the budget has been moved to another year, when the outcome beside
    // it is a different year's and the only honest thing is to go and get it.
    if (fresh.year !== outcome.current.actualsYear) {
      const full = await fetch(`/api/budgets/${budgetId}?evaluated=0`);
      if (full.ok) {
        const withOutcome = (await full.json()) as Budget;
        outcome.current = {
          actuals: withOutcome.actuals,
          actualsSynced: withOutcome.actualsSynced,
          actualsYear: withOutcome.actualsYear,
        };
      }
    }
    if (id !== reload.current) return;
    setBudget(recomputeBudget({ ...fresh, ...outcome.current }));
  }, [budgetId]);

  // Every sheet write goes through here: the shared mutation path for the
  // request and the error message, then a reload. The budget is client-loaded,
  // so the router refresh useMutation does for Server Components isn't enough.
  //
  // `refresh: false` because it is worse than not enough: this page's server
  // component exists to hand over the *first* copy of the budget, which state
  // has owned ever since, so refreshing it re-ran the whole loader (the nested
  // query, the evaluation, the year's ledger) and threw the answer away. Every
  // save was paying for that budget twice and using neither copy.
  //
  // It holds the top progress bar for the whole of it, request and reload
  // both. Every other screen gets that from useMutation's router.refresh; this
  // one reloads itself instead, so it has to say so, and it is the screen
  // where a save is least visible, since a committed cell already shows its new
  // value while the server is still being told about it.
  const api = useCallback(async (
    url: string,
    method: string,
    body?: unknown,
    apply?: (budget: Budget, data: unknown) => Budget,
  ) => {
    const settled = startRouteProgress();
    try {
      const data = await mutate(url, { method, body, error: tCommon("error.action"), refresh: false });
      if (!data) return false;
      // The write has already said what it did, the row it created or the id it
      // removed, so the budget is patched with that and the figures re-derived
      // here. Only a write that cannot describe itself sends us back for the
      // whole budget.
      if (apply) setBudget((prev) => recomputeBudget(apply(prev, data)));
      else await load();
      return true;
    } finally {
      settled();
    }
  }, [load, mutate, tCommon]);

  // The fixed column layout, shared across all sheets.
  const columns = useMemo<ColumnDef[]>(() => orderedColumns(), []);

  // A1 grid across all cost-centre sheets, for ↔ token conversion of references.
  const grid = useMemo<BudgetGrid>(() => buildGrid(
    (budget?.costCenters ?? []).map((cc) => ({
      code: sheetKey(cc),
      accounts: cc.accounts.map((a) => ({
        id: a.id, accountCode: a.accountCode, kindOverride: a.kindOverride,
        lineItems: a.lineItems.map((li) => ({ id: li.id })),
      })),
    })),
    columns,
  ), [budget, columns]);

  // A locked budget is read-only for everyone, admin or not, so every edit
  // affordance below hangs off `canEdit` rather than `isAdmin`. The server
  // refuses the writes too (lib/budget/access.ts); this is what keeps the UI
  // from offering them.
  const locked = budget?.lockedAt != null;
  const canEdit = isAdmin && !locked;

  // The other door: a locked budget is changed by recording a deviation or a
  // transfer beside it, which is the treasurer's alone (see
  // canChangeLockedBudget) and only exists while it is locked.
  const canChange = canChangeLockedBudget(user.capabilities) && locked;

  // Cell renderers + buffered-edit / focus state + optimistic commit.
  const { renderCell, renderFormula } = useBudgetCells({ grid, isAdmin: canEdit, budget, setBudget, mutate, load, api });

  // What this budget is held up against, if anything. Off until asked for, but
  // the join exists either way, and the views read their rows from it.
  const { target: compareTarget, setTarget: setCompareTarget, options: compareOptions, comparison } = useComparison(budget);

  // Lock/unlock is the treasurer's alone, and goes through `mutate` rather
  // than `api` so it can say what happened.
  async function setLocked(next: boolean) {
    setLocking(true);
    try {
      const data = await mutate(`/api/budgets/${budgetId}`, {
        method: "PATCH",
        body: { locked: next },
        success: next ? t("locked") : t("unlocked"),
        error: next ? t("lockFailed") : t("unlockFailed"),
        // As in `api`: the reload below is what this page reads, and refreshing
        // the server component would build the same budget again for nothing.
        refresh: false,
      });
      if (data) await load();
    } finally {
      setLocking(false);
    }
  }

  const ev = budget.evaluated;

  // Two properties of the same budget, saved separately so each pencil writes
  // its own row. Returning false keeps the field open on a value we won't write.
  async function saveYear(raw: string) {
    const year = Number(raw);
    if (!Number.isInteger(year) || year < 1900 || year > 2200) {
      notify.error(tList("invalidYear"));
      return false;
    }
    return api(`/api/budgets/${budgetId}`, "PATCH", { year });
  }

  async function saveName(raw: string) {
    const name = raw.trim();
    if (!name) { notify.error(t("nameRequired")); return false; }
    return api(`/api/budgets/${budgetId}`, "PATCH", { name });
  }

  // The day the möte adopted it. Cleared by emptying the field, which is the
  // only way back to "this was never adopted". A budget recorded as decided by
  // mistake would otherwise be stuck claiming a meeting that did not happen.
  async function saveAdoptedAt(raw: string) {
    const value = raw.trim();
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      notify.error(t("invalidAdoptedAt"));
      return false;
    }
    return api(`/api/budgets/${budgetId}`, "PATCH", { adoptedAt: value || null });
  }

  // Sheets with no cost centre hold none, so they never take one out of the
  // "add" list.
  const usedCc = new Set(budget.costCenters.flatMap((c) => c.costCenter ? [c.costCenter.id] : []));
  const availableCc = allCostCenters.filter((c) => c.active && !usedCc.has(c.id));
  const q = search.trim().toLowerCase();
  // By code. `numeric` compares digit runs as numbers, so AKTU2 sits before
  // AKTU10 rather than after it, since the codes aren't reliably zero-padded.
  // Sheets with no cost centre have no code to sort on and go last, among
  // themselves by name ("sv", so å/ä/ö land where a Swedish reader looks).
  // filter() already copied, so sorting in place doesn't touch the budget.
  const filteredCc = budget.costCenters.filter((c) =>
    !q || sheetName(c, t("unnamed")).toLowerCase().includes(q) ||
    (c.costCenter?.code.toLowerCase().includes(q) ?? false))
    .sort((a, b) => {
      const ca = a.costCenter?.code, cb = b.costCenter?.code;
      if (ca && cb) return ca.localeCompare(cb, "sv", { numeric: true });
      if (ca) return -1;
      if (cb) return 1;
      return sheetName(a, t("unnamed")).localeCompare(sheetName(b, t("unnamed")), "sv");
    });

  const groups = groupByResultUnit(filteredCc, resultUnitOf);

  const cc = selected !== RAMBUDGET && selected !== VARS && selected !== CHANGES
    ? budget.costCenters.find((c) => c.id === selected) ?? null : null;
  const ccCode = cc ? sheetKey(cc) : "";

  // Editorial changes, in the two shapes the views need: the rows to show under
  // each account, and what they have done to each sheet's result. Both count
  // only the changes still in force. See budget-helpers.
  const adjustments = adjustmentRows(budget.changes);
  const impactBySheet = changeImpactBySheet(budget);
  const hasChanges = budget.changes.length > 0;

  // A joined row back to the sheet it is in this budget. The Rambudget needs it
  // to know which of its rows can be opened, since a joined row may be one only
  // the other side has.
  const ccByCompareKey = new Map(budget.costCenters.map((c) => [compareKey(c), c.id]));

  // The open sheet, joined against whatever is being compared. The join always
  // holds this budget's own sheets, so the lookup only misses while a comparison
  // is still loading.
  const openSheet = cc ? comparison.joined.sheets.find((s) => s.key === compareKey(cc)) : undefined;
  const sheetCompare = comparison.otherLabel && openSheet
    ? { label: comparison.otherLabel, sheet: openSheet }
    : null;

  // Duplicate the open sheet and jump to the copy, which lands unconnected.
  async function cloneCc(sourceId: string) {
    const data = await mutate<{ id: string }>(`/api/budgets/${budgetId}/cost-centers`, {
      body: { cloneFromId: sourceId },
      success: t("cloned"),
      error: t("cloneFailed"),
      refresh: false, // the reload below is what this page reads, see `api`
    });
    if (!data) return;
    await load();
    if (data.id) setSelected(data.id);
  }

  return (
    // PageShell like every other screen. This used to compose PageHeader itself
    // and wrap the rest in a bare <div>, only because PageShell typed its title
    // as a string and this page's title is editable in place. The shell takes a
    // node now, so the exception is gone.
    <PageShell
      // The year the budget is for, and the name that tells it apart from the
      // others for the same year, with a line and a pencil each, since they are
      // two separate saves.
      title={
        <span className="flex flex-wrap items-center gap-2">
          <EditableText
            value={String(budget.year)}
            type="number"
            label={t("changeYear")}
            disabled={!canEdit}
            onSave={saveYear}
          />
          {/* Purple, not grey: a lock is not an absence of state, it is the
              authority chain saying this is adopted and only the treasurer
              moves it now. Same colour the approval queue wears. */}
          {locked && (
            <span className="rounded-lg bg-purple-soft px-2 py-1 text-xs font-medium text-purple">
              {tList("locked")}
            </span>
          )}
        </span>
      }
      subtitle={
        <EditableText
          value={budget.name}
          label={t("changeName")}
          placeholder={t("namePlaceholder")}
          disabled={!canEdit}
          onSave={saveName}
        />
      }
      description={
        <>
          {/* Leads, because it is the one fact about a budget that is a
              decision: the möte that passed it. Who typed the row in follows.
              Shown even when unset: an empty slot invites the date, where no
              slot at all hides that the budget is missing one. */}
          {/* The prefix only where there is a date for it to introduce: with
              none, the placeholder is already a whole sentence ("Inte antagen")
              and "Antagen inte antagen" is what prefixing it unconditionally
              produced. */}
          {budget.adoptedAt && <>{t("adoptedOn")} </>}
          <EditableText
            value={budget.adoptedAt ?? ""}
            type="date"
            label={t("changeAdoptedAt")}
            placeholder={t("notAdopted")}
            disabled={!canEdit}
            onSave={saveAdoptedAt}
          />
          <span className="ml-2 text-muted">
          {t("createdBy", { name: budget.createdBy.name })}
          </span>
          {budget.actualsSynced
            ? <span className="ml-2 text-muted">– {t("actualsSynced", { year: budget.actualsYear ?? budget.year })}</span>
            : <span className="ml-2 text-muted">– {t("actualsNotSynced", { year: budget.actualsYear ?? budget.year })}</span>}
          {locked && (
            <span className="ml-2 text-muted">
              –{" "}
              {budget.lockedBy
                ? t("lockedByOn", { name: budget.lockedBy.name, date: date(budget.lockedAt ?? "") })
                : t("lockedOn", { date: date(budget.lockedAt ?? "") })}
            </span>
          )}
          {ev.errors.length > 0 && (
            <span className="ml-2 text-warning">– {tEval(ev.errors[0])}</span>
          )}
        </>
      }
      back={{ href: "/budget", label: tNav("budget") }}
    >
      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Sticky from lg, where the list is a column beside a sheet rather
            than a stack above it. A sheet is the long thing on this screen,
            since a cost centre runs to scores of rows and the rambudget to every
            sheet at once, and the list scrolling away with it made picking
            the next cost centre a scroll back to the top every time.

            No `top-*` here: the offset is the hook's, walked up and down as the
            page scrolls so that a list longer than the screen is reachable in
            full either way (see lib/ui/use-sticky-follow.ts). `self-start` is
            what makes it stick at all. The row stretches its items, so the
            panel was already as tall as the sheet beside it, and a sticky box
            with no scroll range of its own never moves. */}
        <SidebarPanel
          ref={stickyList}
          className="lg:sticky lg:self-start"
          sheetLabel={t("pickCostCenter")}
          // What the collapsed bar says: whichever of the four things this pane
          // is showing. A cost centre brings its result with it, because that is
          // the figure you came to the sheet for and it is one the bar can carry
          // for free.
          bar={
            selected === RAMBUDGET ? (
              t("frameBudget")
            ) : selected === VARS ? (
              t("variables")
            ) : selected === CHANGES ? (
              t("changes")
            ) : cc ? (
              <span className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  {cc.costCenter ? (
                    <>
                      <span className="font-mono text-xs text-muted">{cc.costCenter.code}</span>{" "}
                      {cc.costCenter.name}
                    </>
                  ) : (
                    sheetName(cc, t("unnamed"))
                  )}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-xs tabular-nums",
                    ccTotals(cc, ev).result > 0
                      ? "text-success"
                      : ccTotals(cc, ev).result < 0
                        ? "text-danger"
                        : "text-muted",
                  )}
                >
                  {fmtSigned(ccTotals(cc, ev).result)}
                </span>
              </span>
            ) : (
              t("pickCostCenter")
            )
          }
        >
          {/* The two things that act on the budget as a whole, at the head of
              the column that lists its sheets. The pane on the right is one
              sheet at a time, and both of these change every one of them. They
              were in the page header until that became identity only; the row
              is shaped like the search and "add cost centre" rows further down
              this same panel. */}
          <div className="flex items-center gap-1.5 border-b border-border p-2">
            {/* Nothing is compared until asked for. See use-comparison.tsx. */}
            <Combobox
              size="sm"
              options={[
                { value: "", label: t("noComparison") },
                ...compareOptions.map((o) => ({ value: o.value, label: o.label })),
              ]}
              value={compareTarget}
              onChange={setCompareTarget}
              placeholder={t("compareWith")}
              searchPlaceholder={tList("searchPlaceholder")}
              emptyText={t("nothingToCompare")}
              aria-label={t("compareWith")}
              className="min-w-0 flex-1"
            />
            {/* A closed padlock to lock it, a sprung one to unlock. The icon
                shows the action, and the chip by the year is the state. */}
            {canLock && (
              <IconButton
                label={locked ? t("unlock") : t("lock")}
                loading={locking}
                onClick={() => setLocked(!locked)}
              >
                {locked ? <IconLockOpen className="size-5" /> : <IconLock className="size-5" />}
              </IconButton>
            )}
          </div>
          <SidebarItem
            active={selected === RAMBUDGET}
            onClick={() => setSelected(RAMBUDGET)}
            className="font-medium"
          >
            {t("frameBudget")}
          </SidebarItem>
          <SidebarItem
            active={selected === VARS}
            onClick={() => setSelected(VARS)}
            className="flex items-center justify-between border-t border-border font-medium"
          >
            <span>{t("variables")}</span>
            <span className="text-xs text-muted">{budget.variables.length}</span>
          </SidebarItem>
          {/* Only once there is something to show, or someone who could add to
              it: on an open budget this view has nothing to say. */}
          {(hasChanges || canChange) && (
            <SidebarItem
              active={selected === CHANGES}
              onClick={() => setSelected(CHANGES)}
              className="flex items-center justify-between border-t border-border font-medium"
            >
              <span>{t("changes")}</span>
              <span className="text-xs text-muted">{budget.changes.filter((c) => c.revokedAt == null).length}</span>
            </SidebarItem>
          )}
          <div className="border-t border-border px-3 py-2">
            <Input
              size="sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tAlloc("search")}
            />
          </div>
          {/* The scrollbar floats over the rows instead of taking a column from
              them, the same as the income queue and for the same reason: these
              rows are a cost centre's name against its result, in a 16rem
              panel. See components/ui/overlay-scroll.tsx. */}
          {/* Capped at the same height either way it is standing. A budget runs
              to scores of cost centres, and left to be as long as it liked the
              panel was a column of them beside a sheet a fraction of its
              height. So the list scrolls inside the panel. The scrollbar is
              the floating one, which is why it costs the rows nothing, and
              what the sticky above carries is a box that fits the screen. */}
          <OverlayScroll className="max-h-[58vh]">
            {groups.map((g) => (
              <div key={g.resultUnit}>
                <SidebarGroupLabel>{resultUnitLabel(g.resultUnit, tGroup)}</SidebarGroupLabel>
                <ul>
                  {g.items.map((c) => {
                    const { result } = ccTotals(c, ev);
                    return (
                      <li key={c.id}>
                        <SidebarItem
                          active={selected === c.id}
                          onClick={() => setSelected(c.id)}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="min-w-0 truncate">
                            {c.costCenter
                              ? <><span className="font-mono text-xs text-muted">{c.costCenter.code}</span>{" "}{c.costCenter.name}</>
                              : sheetName(c, t("unnamed"))}
                          </span>
                          <span className={cn("shrink-0 text-xs tabular-nums",
                            result > 0 ? "text-success" : result < 0 ? "text-danger" : "text-muted")}>{fmtSigned(result)}</span>
                        </SidebarItem>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {groups.length === 0 && <EmptyNote size="compact">{t("noCostCenters")}</EmptyNote>}
          </OverlayScroll>
          {/* Every cost centre already budgeted leaves the picker in place but
              dead, rather than removing it: the row vanishing reads as "this
              budget can't take cost centres", which is a different thing. */}
          {canEdit && (
            <div className="flex gap-1.5 border-t border-border p-2">
              {/* Searchable, as in the sheet header: a section has scores of
                  cost centres and the one you want is found by typing its code. */}
              <Combobox
                options={availableCc.map((c) => ({ value: c.id, label: `${c.code} – ${c.name}`, short: c.code }))}
                value={addCcId}
                onChange={setAddCcId}
                disabled={availableCc.length === 0}
                placeholder={availableCc.length === 0 ? t("noFreeCostCenters") : t("addPlaceholder")}
                searchPlaceholder={tAlloc("search")}
                emptyText={t("noFreeCostCenters")}
                className="min-w-0 flex-1"
                aria-label={tAlloc("add")}
              />
              <Button size="sm" loading={addingCc} disabled={!addCcId} onClick={async () => {
                setAddingCc(true);
                try {
                  const ok = await api(`/api/budgets/${budgetId}/cost-centers`, "POST", { costCenterId: addCcId });
                  if (ok) setAddCcId("");
                } finally {
                  setAddingCc(false);
                }
              }}>OK</Button>
            </div>
          )}
        </SidebarPanel>

        <div className="min-w-0 flex-1">
          {selected === RAMBUDGET ? (
            <Rambudget
              comparison={comparison}
              ccIdOf={(key) => ccByCompareKey.get(key)}
              impactOf={(key) => impactBySheet.get(key)}
              showImpact={hasChanges}
              onPick={setSelected}
            />
          ) : selected === VARS ? (
            <VariablesSheet budget={budget} ev={ev} comparison={comparison}
              isAdmin={canEdit} renderCell={renderCell} renderFormula={renderFormula} api={api}
              newVar={newVar} setNewVar={setNewVar} budgetId={budgetId} />
          ) : selected === CHANGES ? (
            <ChangesSheet budget={budget} budgetId={budgetId} canChange={canChange} chart={accounts} api={api} />
          ) : cc ? (
            <>
              <CostCenterHeader
                cc={cc} available={availableCc} canEdit={canEdit} api={api}
                onClone={() => cloneCc(cc.id)}
                onCopyContents={() => {
                  setClip({
                    kind: "accounts",
                    ids: cc.accounts.map((a) => a.id),
                    label: sheetName(cc, t("unnamed")),
                  });
                  notify.success(t("copiedAccounts", { count: cc.accounts.length }));
                }}
                onRemoved={() => setSelected(RAMBUDGET)}
              />
              <CostCenterSheet
                cc={cc} ccCode={ccCode} ev={ev} grid={grid} columns={columns}
                compare={sheetCompare}
                isAdmin={canEdit} canComment={canComment} userId={user.id}
                renderCell={renderCell} renderFormula={renderFormula} api={api} budgetId={budgetId} accounts={accounts}
                adjustments={adjustments}
                clip={clip} onCopy={setClip}
              />
            </>
          ) : (
            <Card>
              <EmptyNote size="page">{t("pickCostCenter")}</EmptyNote>
            </Card>
          )}
        </div>
      </div>

    </PageShell>
  );
}
