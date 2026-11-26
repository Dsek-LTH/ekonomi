"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyNote } from "@/components/ui/empty-state";
import { Combobox } from "@/components/ui/combobox";
import { EditableText } from "@/components/ui/editable-text";
import { OverlayScroll } from "@/components/ui/overlay-scroll";
import { SidebarGroupLabel, SidebarItem, SidebarPanel } from "@/components/ui/sidebar-list";
import { useRole } from "@/components/shell/role-context";
import {
  canChangeLockedBudget,
  canCommentBudget,
  canLockBudget,
  isAdmin as isAdminRole,
} from "@/lib/domain/permissions";
import { useNotify } from "@/components/shell/notifications";
import { useMutation } from "@/components/shell/use-mutation";
import { PageShell } from "@/components/page-shell";
import { startRouteProgress } from "@/components/shell/route-progress";
import { IconGrid, IconList, IconLock, IconLockOpen } from "@/components/ui/icons";
import { Tag } from "@/components/ui/status-pill";

import { buildGrid, orderedColumns, type BudgetGrid, type ColumnDef } from "@/lib/budget/grid";
import { sheetKey, sheetName } from "@/lib/budget";
import { compareKey } from "@/lib/budget/compare";
import { useFillViewport } from "@/lib/ui/use-fill-viewport";
import type { AccountRecord, CostCenter } from "@/lib/domain/types";
import {
  CHANGES,
  RAMBUDGET,
  VARS,
  adjustmentRows,
  changeImpactBySheet,
  resultUnitLabel,
  resultUnitOf,
  groupByResultUnit,
  sheetFromUrl,
  sheetSearch,
  compareSheets,
} from "./budget-helpers";
import { recomputeBudget } from "./recompute";
import { useBudgetCells } from "./use-budget-cells";
import { useUndo, type UndoStep } from "./use-undo";
import { useComparison } from "./use-comparison";
import { Rambudget } from "./rambudget";
import { VariablesSheet } from "./variables-sheet";
import { ChangesSheet } from "./changes-sheet";
import { CostCenterSheet } from "./cost-center-sheet";
import { CostCenterHeader } from "./cost-center-header";
import type { Budget, BudgetClip, LineItem } from "./budget-types";
import { withLine, withLineFields, withLineOrder, withoutLine } from "./patch-budget";
import { SearchInput } from "@/components/ui/search-input";
import { nameUnderUnit } from "@/lib/domain/cost-center-short-name";
import { ViewToggle } from "@/components/ui/view-toggle";

// Other people's edits arrive pushed (the live stream below). This poll is only the safety net
// for a stream that is down; a quiet budget answers it 304 with no body.
const BUDGET_POLL_MS = 30_000;

export default function BudgetClient({
  initialBudget,
  initialView,
  initialSheet,
  costCenters: allCostCenters,
  accounts,
}: {
  /** Server-rendered first copy; the client owns the budget from here on. */
  initialBudget: Budget;
  /** `?view=` and `?sheet=` as the page was loaded (sheetSearch in budget-helpers.ts). */
  initialView?: string;
  initialSheet?: string;
  costCenters: CostCenter[];
  accounts: AccountRecord[];
}) {
  const { budgetId } = useParams<{ budgetId: string }>();
  const t = useTranslations("budget.sheet");
  const tCommon = useTranslations("common");
  const tList = useTranslations("budget.list");
  const tAlloc = useTranslations("allocation");
  const tEval = useTranslations("budget.eval");
  const tGroup = useTranslations("budget.group");
  const { user } = useRole();
  const notify = useNotify();
  const { mutate } = useMutation();
  const isAdmin = isAdminRole(user.capabilities);
  const canComment = canCommentBudget(user.capabilities);
  const canLock = canLockBudget(user.capabilities);

  // Client state: committing a cell re-evaluates every formula in the browser (use-budget-cells).
  const [budget, setBudget] = useState<Budget>(initialBudget);
  // What is open: rambudget, variables, changes, or a sheet by id. Null opens the first cost centre.
  // Read from the address as it is now, not as the page was loaded: the address follows every
  // pick (setSelected), so a remount (a hot reload, say) reopens what was open rather than the
  // view the page first came up on. The props are the same address on the server's first render.
  const [address] = useState(() => {
    if (typeof window === "undefined") return { view: initialView, sheet: initialSheet };
    const q = new URLSearchParams(window.location.search);
    return { view: q.get("view") ?? undefined, sheet: q.get("sheet") ?? undefined };
  });
  const urlSheet = sheetFromUrl(address.sheet);
  const [picked, setPicked] = useState<string | null>(
    address.view === "frame" ? RAMBUDGET : urlSheet,
  );
  // Written to the address with the native history API, which Next syncs with its router. A
  // router.replace would re-render the page on the server, fetching the whole budget again
  // only for the client to ignore it (it owns the budget after the first copy).
  const setSelected = (next: string) => {
    setPicked(next);
    const search = sheetSearch(window.location.search, next);
    window.history.replaceState(null, "", search ? `?${search}` : window.location.pathname);
  };
  const [search, setSearch] = useState("");
  const [addCcId, setAddCcId] = useState("");

  const [locking, setLocking] = useState(false);
  const [addingCc, setAddingCc] = useState(false);

  // Held on the page: the source sheet unmounts when the next one is picked. A copy stays until replaced.
  const [clip, setClip] = useState<BudgetClip | null>(null);

  // From lg the views are sized to the window and scroll on their own (lib/ui/use-fill-viewport.ts).
  const fillRef = useFillViewport<HTMLDivElement>();

  const [newVar, setNewVar] = useState("");

  // The year's outcome from the ledger, held here so `load` need not depend on the state it sets.
  const outcome = useRef({
    actuals: initialBudget.actuals,
    actualsSynced: initialBudget.actualsSynced,
    actualsYear: initialBudget.actualsYear,
  });

  // Re-read the budget after a write (same loader as the page, lib/data/budget.ts). Skips the
  // outcome (no budget edit changes it) and the evaluated figures (this page recomputes them).
  // Not a `useQuery`, but borrows its staleness guard: a slower earlier reload landing last
  // would undo the later edit.
  const reload = useRef(0);
  // The version on screen as the server tagged it, so a poll that finds nothing new costs no
  // body (304). Dropped after each own write, whose result is patched in without a read.
  const etag = useRef<string | null>(null);
  // Own writes in flight, and a counter moved by each start and end. A poll answer that left
  // before a write and lands after it describes the budget without it, so it is dropped.
  const writes = useRef({ inFlight: 0, gen: 0 });
  // A live re-read was skipped or dropped for an own write, so it is owed once that ends.
  const owed = useRef(false);
  const loadRef = useRef<(opts?: { poll?: boolean }) => Promise<void>>(async () => {});
  /** Runs an own write so the poll knows of it: started before anything is shown, ended after. */
  const tracked = useCallback(async <T,>(write: () => Promise<T>): Promise<T> => {
    writes.current.inFlight++;
    writes.current.gen++;
    try {
      return await write();
    } finally {
      writes.current.inFlight--;
      writes.current.gen++;
      etag.current = null;
      if (owed.current && writes.current.inFlight === 0) {
        owed.current = false;
        void loadRef.current({ poll: true });
      }
    }
  }, []);
  const load = useCallback(
    async (opts?: { poll?: boolean }) => {
      const id = ++reload.current;
      const gen = writes.current.gen;
      const res = await fetch(`/api/budgets/${budgetId}?actuals=0&evaluated=0`, {
        cache: "no-store",
        headers: etag.current ? { "If-None-Match": etag.current } : undefined,
      });
      if (res.status === 304 || !res.ok || id !== reload.current) return;
      if (opts?.poll && (writes.current.inFlight > 0 || writes.current.gen !== gen)) {
        owed.current = true;
        return;
      }
      const tag = res.headers.get("ETag");
      const fresh = (await res.json()) as Budget;
      // Unless the budget moved to another year: then the outcome is a different year's.
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
      if (opts?.poll && (writes.current.inFlight > 0 || writes.current.gen !== gen)) {
        owed.current = true;
        return;
      }
      etag.current = tag;
      setBudget(recomputeBudget({ ...fresh, ...outcome.current }));
    },
    [budgetId],
  );

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  // Live: each write to this budget, anybody's, is pushed down a server-sent event stream
  // (lib/server/budget-live.ts), and the page re-reads the budget when it hears one. Typing is
  // not disturbed: a cell's text being edited is held apart from the budget
  // (use-budget-cells.tsx), so only the figures around it move.
  useEffect(() => {
    const live = () => {
      if (writes.current.inFlight > 0) owed.current = true;
      else void load({ poll: true });
    };
    const stream = new EventSource(`/api/budgets/${budgetId}/live`);
    stream.onmessage = live;
    // After a reconnect, whatever was sent while it was down is caught up. The first open
    // costs one re-read too, covering edits since the page was rendered.
    stream.onopen = live;
    return () => stream.close();
  }, [budgetId, load]);

  useEffect(() => {
    const tick = () => {
      if (document.hidden || writes.current.inFlight > 0) return;
      void load({ poll: true });
    };
    const timer = window.setInterval(tick, BUDGET_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // Every sheet write goes through here: shared mutation path, then a reload. `refresh: false`
  // because the server component only hands over the first copy, so refreshing it re-ran the
  // whole loader for nothing. Holds the top progress bar for request and reload, since a
  // committed cell already shows its value.
  const api = useCallback(
    async (
      url: string,
      method: string,
      body?: unknown,
      apply?: (budget: Budget, data: unknown) => Budget,
      onDone?: (data: unknown) => void,
    ) => {
      const settled = startRouteProgress();
      try {
        return await tracked(async () => {
          const data = await mutate(url, {
            method,
            body,
            error: tCommon("error.action"),
            refresh: false,
          });
          if (!data) return false;
          onDone?.(data);
          // The write describes itself (created row or removed id), so patch the budget with that
          // and re-derive the figures. Only an undescribed write reloads the whole budget.
          if (apply) setBudget((prev) => recomputeBudget(apply(prev, data)));
          else await load();
          return true;
        });
      } finally {
        settled();
      }
    },
    [load, mutate, tCommon, tracked],
  );

  const columns = useMemo<ColumnDef[]>(() => orderedColumns(), []);

  const grid = useMemo<BudgetGrid>(
    () =>
      buildGrid(
        budget.costCenters.map((cc) => ({
          code: sheetKey(cc),
          accounts: cc.accounts.map((a) => ({
            id: a.id,
            accountCode: a.accountCode,
            lineItems: a.lineItems.map((li) => ({ id: li.id })),
          })),
        })),
        columns,
      ),
    [budget, columns],
  );

  // A locked budget is read-only for everyone, so edit affordances hang off `canEdit`, not
  // `isAdmin`. The server refuses the writes too (lib/budget/access.ts).
  const locked = budget.lockedAt != null;
  const canEdit = isAdmin && !locked;

  // A locked budget changes only by a deviation or transfer, the treasurer's alone (canChangeLockedBudget).
  const canChange = canChangeLockedBudget(user.capabilities) && locked;

  // ⌘Z history (use-undo.ts). The cells record into it before the history exists in this
  // render order, so they are handed a stable function that forwards to it.
  const recordRef = useRef<(step: UndoStep) => void>(() => {});
  const budgetRef = useRef(budget);
  useEffect(() => {
    budgetRef.current = budget;
  }, [budget]);
  const record = useCallback((step: UndoStep) => recordRef.current(step), []);

  const { renderCell, renderFormula, renderFormulaBar, commitField, forgetCell } = useBudgetCells({
    grid,
    isAdmin: canEdit,
    budget,
    setBudget,
    mutate,
    load,
    api,
    tracked,
    record,
  });

  const undo = useUndo({
    applyField: commitField,
    // Many cells in one request (api/budgets/[id]/cells), shown together once it answers.
    applyFields: async (writes) => {
      const lines = writes.flatMap((w) => {
        const id = w.url.match(/\/budget-line-items\/([^/]+)$/)?.[1];
        // Only Beskrivning and Belopp travel in a fields step (a block paste).
        const fields = w.payload as { description?: string; expression?: string };
        return id ? [{ id, ...fields }] : [];
      });
      if (lines.length === 0) return;
      await api(`/api/budgets/${budgetId}/cells`, "POST", { lines }, (b) =>
        lines.reduce<Budget>((acc, { id, ...fields }) => withLineFields(acc, id, fields), b),
      );
    },
    createLine: async (accountId, body) => {
      let id: string | null = null;
      const ok = await api(
        `/api/budget-accounts/${accountId}/line-items`,
        "POST",
        body,
        (b, data) => withLine(b, accountId, data as LineItem),
        (data) => {
          id = (data as LineItem).id;
        },
      );
      return ok ? id : null;
    },
    deleteLine: (lineId) =>
      api(`/api/budget-line-items/${lineId}`, "DELETE", undefined, (b) => withoutLine(b, lineId)),
    deleteLines: (lineIds) =>
      api(`/api/budgets/${budgetId}/lines/delete`, "POST", { ids: lineIds }, (b) =>
        lineIds.reduce((acc, id) => withoutLine(acc, id), b),
      ),
    restoreLines: async (lines, orders) => {
      let made: Record<string, string> | null = null;
      type Restored = {
        made: Record<string, string>;
        created: (LineItem & { accountId: string })[];
        orders: { accountId: string; ids: string[] }[];
      };
      const ok = await api(
        `/api/budgets/${budgetId}/lines/restore`,
        "POST",
        {
          lines: lines.map((l) => ({ key: l.lineId, accountId: l.accountId, ...l.body })),
          orders,
        },
        (b, data) => {
          const r = data as Restored;
          const withMade = r.created.reduce((acc, li) => withLine(acc, li.accountId, li), b);
          return r.orders.reduce((acc, o) => withLineOrder(acc, o.accountId, o.ids), withMade);
        },
        (data) => {
          made = (data as Restored).made;
        },
      );
      return ok ? made : null;
    },
    reorder: (accountId, ids, made) => {
      // Only lines still in this account: the route moves a line from another account onto
      // this one, so a line dragged away since would be pulled back. Read from the latest
      // budget, which the line just made may not have reached yet, hence `made`.
      const now = new Set(
        budgetRef.current.costCenters.flatMap((c) =>
          c.accounts.filter((a) => a.id === accountId).flatMap((a) => a.lineItems.map((l) => l.id)),
        ),
      );
      const orderedIds = ids.filter((x) => x === made || now.has(x));
      return api(
        `/api/budget-accounts/${accountId}/line-items/reorder`,
        "POST",
        { orderedIds },
        (b) => withLineOrder(b, accountId, orderedIds),
      );
    },
  });
  useEffect(() => {
    recordRef.current = undo.record;
  }, [undo.record]);

  const {
    target: compareTarget,
    setTarget: setCompareTarget,
    options: compareOptions,
    comparison,
  } = useComparison(budget);

  // Lock/unlock is the treasurer's alone, via `mutate` so it can say what happened.
  async function setLocked(next: boolean) {
    setLocking(true);
    try {
      const data = await mutate(`/api/budgets/${budgetId}`, {
        method: "PATCH",
        body: { locked: next },
        success: next ? t("locked") : t("unlocked"),
        error: next ? t("lockFailed") : t("unlockFailed"),
        // As in `api`: no server-component refresh.
        refresh: false,
      });
      if (data) await load();
    } finally {
      setLocking(false);
    }
  }

  const ev = budget.evaluated;

  async function saveName(raw: string) {
    const name = raw.trim();
    if (!name) {
      notify.error(t("nameRequired"));
      return false;
    }
    return api(`/api/budgets/${budgetId}`, "PATCH", { name });
  }

  const usedCc = new Set(
    budget.costCenters.flatMap((c) => (c.costCenter ? [c.costCenter.id] : [])),
  );
  const availableCc = allCostCenters.filter((c) => c.active && !usedCc.has(c.id));
  const q = search.trim().toLowerCase();
  // In sheet order (compareSheets), as the sidebar lists them.
  const sortedCc = [...budget.costCenters].sort((a, b) =>
    compareSheets(
      { code: a.costCenter?.code ?? null, name: sheetName(a, t("unnamed")) },
      { code: b.costCenter?.code ?? null, name: sheetName(b, t("unnamed")) },
    ),
  );
  const filteredCc = sortedCc.filter(
    (c) =>
      !q ||
      sheetName(c, t("unnamed")).toLowerCase().includes(q) ||
      (c.costCenter?.shortName?.toLowerCase().includes(q) ?? false) ||
      (c.costCenter?.code.toLowerCase().includes(q) ?? false),
  );

  const groups = groupByResultUnit(filteredCc, resultUnitOf);
  // Opens on the first cost centre as listed unfiltered (so searching does not move it), or on
  // the variables if there are none.
  // A sheet named by an old link may be gone, so an unknown id opens the default too.
  const known =
    picked === RAMBUDGET ||
    picked === VARS ||
    picked === CHANGES ||
    budget.costCenters.some((c) => c.id === picked);
  const selected =
    (known ? picked : null) ??
    groupByResultUnit(budget.costCenters, resultUnitOf)[0]?.items[0]?.id ??
    VARS;

  const cc =
    selected !== RAMBUDGET && selected !== VARS && selected !== CHANGES
      ? (budget.costCenters.find((c) => c.id === selected) ?? null)
      : null;
  const ccCode = cc ? sheetKey(cc) : "";

  // Which view is open; the detail view returns to the sheet last open there.
  const view = selected === RAMBUDGET ? "FRAME" : "DETAIL";
  const [lastDetail, setLastDetail] = useState<string | null>(urlSheet);
  if (selected !== RAMBUDGET && selected !== lastDetail) setLastDetail(selected);
  const detailTarget =
    (lastDetail &&
    (lastDetail === VARS ||
      lastDetail === CHANGES ||
      budget.costCenters.some((c) => c.id === lastDetail))
      ? lastDetail
      : null) ??
    groups[0]?.items[0]?.id ??
    VARS;

  /** The sheet after `id` in the list as drawn (the one before, if it was last), else Variabler. */
  const neighbourOf = (id: string) => {
    const order = groupByResultUnit(sortedCc, resultUnitOf).flatMap((g) =>
      g.items.map((c) => c.id),
    );
    const i = order.indexOf(id);
    return order[i + 1] ?? order[i - 1] ?? VARS;
  };

  // Editorial changes in force: rows per account and the effect on each sheet's result.
  const adjustments = adjustmentRows(budget.changes);
  const impactBySheet = changeImpactBySheet(budget);
  const hasChanges = budget.changes.length > 0;

  // A joined row back to its sheet here (a joined row may exist only on the other side).
  const ccByCompareKey = new Map(budget.costCenters.map((c) => [compareKey(c), c.id]));

  // The open sheet, joined against the comparison. Misses only while it is loading.
  const openSheet = cc ? comparison.joined.sheets.find((s) => s.key === compareKey(cc)) : undefined;
  const sheetCompare =
    comparison.otherLabel && openSheet
      ? { label: comparison.otherLabel, sheet: openSheet, vsActuals: comparison.vsActuals }
      : null;

  async function cloneCc(sourceId: string) {
    const data = await mutate<{ id: string }>(`/api/budgets/${budgetId}/cost-centers`, {
      body: { cloneFromId: sourceId },
      success: t("cloned"),
      error: t("cloneFailed"),
      refresh: false,
    });
    if (!data) return;
    await load();
    if (data.id) setSelected(data.id);
  }

  return (
    <PageShell
      // The name and the lock. The antagen date is edited in the budget list (budget-list-client.tsx).
      title={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <EditableText
            value={budget.name}
            label={t("changeName")}
            placeholder={t("namePlaceholder")}
            disabled={!canEdit}
            onSave={saveName}
          />
          {locked && <Tag tone="purple">{tList("locked")}</Tag>}
        </span>
      }
      back="/budget"
      // View, comparison and lock on the title line, so the sheet starts right under it.
      aside={
        <div className="flex w-full flex-wrap items-center justify-end gap-2 md:w-auto">
          <ViewToggle
            labels
            aria-label={t("view")}
            value={view}
            options={[
              { value: "DETAIL", label: t("detailBudget"), icon: IconList },
              { value: "FRAME", label: t("frameBudget"), icon: IconGrid },
            ]}
            onChange={(v) => setSelected(v === "FRAME" ? RAMBUDGET : detailTarget)}
            className="shrink-0"
          />

          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
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
              className="min-w-0 flex-1 md:w-64 md:flex-none"
            />
            {canLock && (
              <Button
                variant="secondary"
                size="sm"
                loading={locking}
                onClick={() => setLocked(!locked)}

                aria-label={locked ? t("unlock") : t("lock")}
                title={locked ? t("unlock") : t("lock")}
              >
                {locked ? <IconLockOpen className="size-4" /> : <IconLock className="size-4" />}
                <span className="hidden md:inline">{locked ? t("unlock") : t("lock")}</span>
              </Button>
            )}
          </div>
        </div>
      }
    >
      {ev.errors.length > 0 && <p className="text-sm text-warning">{tEval(ev.errors[0])}</p>}
      {/* One element for both views, so the window-sized box is not swapped out from under its sizing hook. */}
      <div ref={fillRef} className="lg:-mb-14 print:h-auto!">
        {selected === RAMBUDGET ? (
          <div className="lg:flex lg:h-full lg:flex-col">
            <Rambudget
              comparison={comparison}
              ccIdOf={(key) => ccByCompareKey.get(key)}
              impactOf={(key) => impactBySheet.get(key)}
              showImpact={hasChanges}
              onPick={setSelected}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4 lg:h-full lg:flex-row">
            <SidebarPanel
              className="lg:flex lg:max-h-full lg:flex-col"
              cardClassName="lg:flex lg:min-h-0 lg:flex-col"
              sheetLabel={t("pickCostCenter")}

              bar={
                selected === VARS ? (
                  t("variables")
                ) : selected === CHANGES ? (
                  t("changes")
                ) : cc ? (
                  <span className="block min-w-0 truncate">
                    {cc.costCenter ? (
                      <>
                        <span className="font-mono text-xs text-muted">{cc.costCenter.code}</span>{" "}
                        {cc.costCenter.name}
                      </>
                    ) : (
                      sheetName(cc, t("unnamed"))
                    )}
                  </span>
                ) : (
                  t("pickCostCenter")
                )
              }
            >
              <SidebarItem
                active={selected === VARS}
                onClick={() => setSelected(VARS)}
                className="flex items-center justify-between font-medium"
              >
                <span>{t("variables")}</span>
                <span className="text-xs text-muted">{budget.variables.length}</span>
              </SidebarItem>

              {(hasChanges || canChange) && (
                <SidebarItem
                  active={selected === CHANGES}
                  onClick={() => setSelected(CHANGES)}
                  className="flex items-center justify-between border-t border-border font-medium"
                >
                  <span>{t("changes")}</span>
                  <span className="text-xs text-muted">
                    {budget.changes.filter((c) => c.revokedAt == null).length}
                  </span>
                </SidebarItem>
              )}
              <div className="border-t border-border px-3 py-2">
                <SearchInput
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={tAlloc("search")}
                  aria-label={tAlloc("search")}
                />
              </div>

              <OverlayScroll
                className="max-h-[58vh] lg:min-h-0 lg:flex-1 lg:max-h-none"
                frameClassName="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col"
              >
                {groups.map((g) => (
                  <div key={g.resultUnit}>
                    <SidebarGroupLabel>{resultUnitLabel(g.resultUnit, tGroup)}</SidebarGroupLabel>
                    <ul>
                      {g.items.map((c) => (
                        <li key={c.id}>
                          <SidebarItem
                            active={selected === c.id}
                            onClick={() => setSelected(c.id)}
                            title={c.costCenter?.shortName ? c.costCenter.name : undefined}
                            className="truncate"
                          >
                            {c.costCenter ? (
                              <>
                                <span className="font-mono text-xs text-muted">
                                  {c.costCenter.code}
                                </span>{" "}
                                {nameUnderUnit(c.costCenter)}
                              </>
                            ) : (
                              sheetName(c, t("unnamed"))
                            )}
                          </SidebarItem>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {groups.length === 0 && <EmptyNote size="compact">{t("noCostCenters")}</EmptyNote>}
              </OverlayScroll>

              {canEdit && (
                <div className="flex gap-1.5 border-t border-border p-2">
                  <Combobox
                    options={availableCc.map((c) => ({
                      value: c.id,
                      label: `${c.code} - ${c.name}`,
                      short: c.code,
                    }))}
                    value={addCcId}
                    onChange={setAddCcId}
                    disabled={availableCc.length === 0}
                    placeholder={
                      availableCc.length === 0 ? t("noFreeCostCenters") : t("addPlaceholder")
                    }
                    searchPlaceholder={tAlloc("search")}
                    emptyText={t("noFreeCostCenters")}
                    className="min-w-0 flex-1"
                    aria-label={tAlloc("add")}
                  />
                  <Button
                    size="sm"
                    loading={addingCc}
                    disabled={!addCcId}
                    onClick={async () => {
                      setAddingCc(true);
                      try {
                        const ok = await api(`/api/budgets/${budgetId}/cost-centers`, "POST", {
                          costCenterId: addCcId,
                        });
                        if (ok) setAddCcId("");
                      } finally {
                        setAddingCc(false);
                      }
                    }}
                  >
                    OK
                  </Button>
                </div>
              )}
            </SidebarPanel>

            <div className="min-w-0 flex-1 lg:h-full lg:overflow-y-auto lg:overscroll-contain print:h-auto print:overflow-visible">
              {selected === VARS ? (
                <VariablesSheet
                  budget={budget}
                  ev={ev}
                  comparison={comparison}
                  isAdmin={canEdit}
                  renderCell={renderCell}
                  renderFormula={renderFormula}
                  api={api}
                  newVar={newVar}
                  setNewVar={setNewVar}
                  budgetId={budgetId}
                />
              ) : selected === CHANGES ? (
                <ChangesSheet
                  budget={budget}
                  budgetId={budgetId}
                  canChange={canChange}
                  chart={accounts}
                  api={api}
                />
              ) : cc ? (
                <>
                  <CostCenterHeader
                    cc={cc}
                    available={availableCc}
                    canEdit={canEdit}
                    api={api}
                    onClone={() => cloneCc(cc.id)}
                    onCopyContents={() => {
                      setClip({
                        kind: "accounts",
                        ids: cc.accounts.map((a) => a.id),
                        label: sheetName(cc, t("unnamed")),
                      });
                    }}
                    // The sheet beside it in the list, so removing one stays in the detail view.
                    onRemoved={() => setSelected(neighbourOf(cc.id))}
                  />
                  <CostCenterSheet
                    cc={cc}
                    ccCode={ccCode}
                    ev={ev}
                    grid={grid}
                    columns={columns}
                    compare={sheetCompare}
                    isAdmin={canEdit}
                    canComment={canComment}
                    userId={user.id}
                    renderCell={renderCell}
                    renderFormula={renderFormula}
                    forgetCell={forgetCell}
                    formulaBar={renderFormulaBar({
                      formula: t("formulaBar"),
                      hint: t("formulaBarHint"),
                    })}
                    api={api}
                    budgetId={budgetId}
                    accounts={accounts}
                    adjustments={adjustments}
                    clip={clip}
                    onCopy={setClip}
                    record={record}
                  />
                </>
              ) : (
                <Card>
                  <EmptyNote size="page">{t("pickCostCenter")}</EmptyNote>
                </Card>
              )}
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
