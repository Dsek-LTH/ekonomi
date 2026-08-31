"use client";

// Granska & bokför: the days that came back from a fetch, one at a time.
//
// Three columns and no page loads. The days on the left, the voucher for the
// selected one in the middle, and the intäktsräkning in the shell's document
// panel on the right, so the evidence, the figures and the queue are all in
// front of you at once, and booking a day moves to the next without a round
// trip through a list page. A term of Swish is a hundred-odd days; that is the
// difference between an afternoon and a morning.
//
// The voucher table is the same component the utlägg booking screen uses
// (components/voucher-editor.tsx), pre-filled from the day's account
// distributions. Most days need nothing done to it, and those go through "book
// all" without ever being opened, so the editor is for the day that needs
// fixing, not a form to fill in a hundred times.
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { useConfirm } from "@/components/confirm-dialog";
import { PageShell } from "@/components/page-shell";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { useNotify } from "@/components/shell/notifications";
import { useMutation } from "@/components/shell/use-mutation";
import {
  filledVoucherRows,
  type VoucherEditorRow,
} from "@/components/voucher-editor";
import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import {
  IconAlert,
  IconDownload,
  IconElbow,
  IconLock,
  IconPlus,
  IconViewSplit,
  IconViewTable,
} from "@/components/ui/icons";
import { ViewToggle } from "@/components/ui/view-toggle";
import { productDisplayName, productRows } from "@/lib/income/product-groups";
import { Combobox } from "@/components/ui/combobox";
import { DragHandle } from "@/components/ui/drag";
import { ClientDataTable } from "@/components/ui/client-data-table";
import { OverlayScroll } from "@/components/ui/overlay-scroll";
import { SidebarGroupLabel, SidebarItem, SidebarPanel } from "@/components/ui/sidebar-list";
import { TableScroll } from "@/components/ui/table-scroll";
import { useTableControls } from "@/lib/data/use-list-query";
import { incomeVoucherDescription } from "@/lib/income/voucher";
import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";
import type { IncomeMoveTarget, IncomeReportRow, IncomeReviewQueue } from "@/lib/data/income";
import type { IncomeSettingsRow } from "@/lib/data/income-config";
import type { AccountRecord, CostCenter } from "@/lib/domain/types";

import {
  costCentreFor,
  defaultRows,
  documentUrl,
  isDuplicate,
  voucherFor as voucherDraft,
} from "./voucher-draft";
import { AlreadyBookedNotice, EmptyReportCard, VoucherCard } from "./report-detail";
import { reviewColumns } from "./review-columns";
import { useLineDrag } from "./use-line-drag";
import { FetchPanel } from "./fetch-panel";
import { incomeSections } from "./sections";
import { MoveLinesDialog, accountOptions, suggestedAccount, type MoveRequest } from "./move-dialog";
import {
  NewReportDialog,
  type NewReportRequest,
  type NewReportSource,
} from "./new-report-dialog";

export default function IncomeReviewClient({
  queue,
  settings,
  costCenters,
  accounts,
  moveTargets,
  serviceConfigured,
  initialReportId,
}: {
  queue: IncomeReviewQueue;
  settings: IncomeSettingsRow;
  costCenters: CostCenter[];
  accounts: AccountRecord[];
  /** Where a mis-routed sale can be moved to. See move-dialog.tsx. */
  moveTargets: IncomeMoveTarget[];
  serviceConfigured: boolean;
  /**
   * Which day to open on, when the caller has one in mind.
   *
   * How reopening lands you on the day you just unbooked: it goes back into the
   * queue like any other draft, and the queue is a hundred days long, so
   * arriving at whichever one happens to be first would be arriving nowhere.
   */
  initialReportId?: string;
}) {
  const t = useTranslations("income");
  const tBook = useTranslations("book");
  const { date: formatDate } = useFormat();
  // One fetch at a time: what came back from the latest one, and nothing else.
  // A fetch replaces whatever unbooked days its range held, so this is exactly
  // the period you just asked for, which is what makes re-fetching after a
  // routing fix show the corrected days and only those.
  const drafts = queue.reports;
  const notify = useNotify();
  const confirm = useConfirm();
  const { pending, busy, mutate } = useMutation();

  // Two ways of looking at the same fetch: one day at a time with its
  // intäktsräkning beside it, or all of them at once. Not another destination
  // in the nav: it is the same reports, and which one you want depends on
  // whether you are checking them or working through them.
  const [mode, setMode] = useState<"review" | "table">("review");
  // Whether the fetch panel is showing. Open on arrival when there is nothing
  // to review: an empty queue is a screen whose only next step is a fetch.
  const [fetchOpen, setFetchOpen] = useState(drafts.length === 0);
  const controls = useTableControls({ sortKey: "date", sortDir: "asc" });
  const [selectedId, setSelectedId] = useState<string | null>(
    initialReportId ?? drafts[0]?.id ?? null,
  );
  // Edits, kept per day so moving down the list and back does not throw them
  // away. A day that has not been touched is not in here at all, and its rows are
  // derived on the spot, which is also what keeps them in step with a cost
  // centre changed elsewhere.
  const [edits, setEdits] = useState<Record<string, VoucherEditorRow[]>>({});
  // Which sold lines are picked for a move, and whether the dialog that moves
  // them is open. Per line rather than per day: the ordinary case is a handful
  // of mis-rung products among a day's proper sales.
  //
  // Both carry the day they belong to, so moving down the queue drops them
  // without anything having to notice that it should. A count in the footer
  // describing another day's lines is the bug this shape rules out.
  const [selection, setSelection] = useState<{ reportId: string; lineIds: string[] }>({
    reportId: "",
    lineIds: [],
  });
  const [moveFor, setMoveFor] = useState<string | null>(null);
  // Which day the "ny rapport" dialog is open for: a report for a verksamhet
  // the fetch made none for, to move sales onto. See new-report-dialog.tsx.
  //
  // The day and the payment method both come from the group in the queue whose
  // button was pressed, so the dialog has one thing to ask rather than three.
  const [newFor, setNewFor] = useState<{ date: string; source: NewReportSource } | null>(null);
  // The selection survives a refresh by id. When the day it pointed at is gone,
  // whether just booked or moved away entirely, the list's first day stands in.
  const selected = drafts.find((d) => d.id === selectedId) ?? drafts[0] ?? null;

  // Reading a PDF is a render on the far side, so the next day's is asked for
  // while this one is being looked at: by the time you book and move on, the
  // browser has it. Nothing is stored either side. See lib/income/document.ts.
  useEffect(() => {
    if (!selected) return;
    const index = drafts.findIndex((d) => d.id === selected.id);
    const next = drafts[index + 1];
    // A report with no lines has no intäktsräkning to render. See `isEmpty`.
    if (!next || next.lines.length === 0) return;
    const controller = new AbortController();
    void fetch(documentUrl(next), {
      signal: controller.signal,
    }).catch(() => {
      // A prefetch that fails is not an error anyone should hear about; the
      // real request will fail the same way and say so properly.
    });
    return () => controller.abort();
  }, [selected, drafts]);


  const rowsFor = (report: IncomeReportRow) => edits[report.id] ?? defaultRows(report, settings);
  const setRows = (report: IncomeReportRow, rows: VoucherEditorRow[]) =>
    setEdits((e) => ({ ...e, [report.id]: rows }));

  /**
   * Whether a day's rows are still the ones this app derived, which is what
   * decides whose voucher gets booked, and what the list says about the day.
   *
   * Asked of the rows and not of `edits[id]` having something in it, because
   * the editor writes back the moment it is rendered: it keeps three spare rows
   * under the last one, and putting them there is a change to the array without
   * being a change to the voucher. Compared on the values, so undoing an edit by
   * hand also counts as untouched.
   */
  const rowSignature = (rows: VoucherEditorRow[]) =>
    filledVoucherRows(rows)
      .map((r) => [r.account.trim(), r.costCenterCode.trim(), r.description.trim(), r.debit, r.credit].join("|"))
      .join(";");
  const isEdited = (report: IncomeReportRow) => {
    const rows = edits[report.id];
    return !!rows && rowSignature(rows) !== rowSignature(defaultRows(report, settings));
  };

  /**
   * The voucher exactly as it will be posted. Both the button's enabled state
   * and the request read this, so the button can only be live for a voucher the
   * server will accept. See ./voucher-draft, where the rules live.
   */
  const voucherFor = (report: IncomeReportRow) =>
    voucherDraft({
      report,
      rows: rowsFor(report),
      settings,
      accounts,
      costCenters,
      label: {
        source: t(`source.${report.source}`),
        clearingHint: t("book.clearingHint"),
        clearingLocked: t("book.clearingLocked"),
      },
    });

  /** Move to the next day still waiting, or the previous one if this was last. */
  function advance(fromId: string) {
    const index = drafts.findIndex((d) => d.id === fromId);
    setSelectedId((drafts[index + 1] ?? drafts[index - 1])?.id ?? null);
  }

  async function book(report: IncomeReportRow) {
    // Only a day someone actually edited is booked from the browser's rows. An
    // untouched one is booked from the report itself, by the server that owns
    // that derivation. The editor was showing a preview of it, and a preview
    // is not a better source than the thing it previews.
    const body = isEdited(report) ? { lines: voucherFor(report).lines } : {};
    const done = await mutate(`/api/income/reports/${report.id}/book`, {
      key: `book-${report.id}`,
      body,
      error: t("bookFailed"),
      success: t("bookDone"),
    });
    if (!done) return;
    // The edits are spent: the day is booked and its rows are in the ledger.
    setEdits((e) => Object.fromEntries(Object.entries(e).filter(([id]) => id !== report.id)));
    advance(report.id);
  }

  /**
   * Move the picked lines onto another verksamhet's report for the same day.
   *
   * Both reports' voucher edits go with them. The rows in the editor are a
   * function of the day's lines, so an edit made before a move is an opinion
   * about a day that no longer exists, and it is the one thing that would
   * survive the refresh below, because it lives here rather than in the
   * database. Dropping it puts both days back on what they derive.
   */
  async function move(report: IncomeReportRow, request: MoveRequest) {
    const done = await mutate<{ sourceId: string | null; destinationId: string }>(
      `/api/income/reports/${report.id}/move`,
      {
        key: `move-${report.id}`,
        body: request,
        error: t("move.failed"),
        success: t("move.done", { count: request.lines.length }),
      },
    );
    if (!done) return;
    setEdits((e) =>
      Object.fromEntries(
        Object.entries(e).filter(([id]) => id !== report.id && id !== done.destinationId),
      ),
    );
    setSelection({ reportId: "", lineIds: [] });
    setMoveFor(null);
    // The day the money is now on, which is what someone who just moved it
    // wants to look at, and the only thing left to select when the move
    // emptied the report they were on.
    setSelectedId(done.destinationId);
  }

  /**
   * Make a report for a verksamhet the fetch produced none for, and open it.
   *
   * The half of a split that has nowhere to go. Moving lines out of the fallback
   * creates the destination's report when there is none, but only for the
   * verksamhet being moved to, so a day whose takings belong to two others has
   * to become two reports, and one of them exists nowhere until this makes it.
   *
   * It may hand back a report rather than a new one: a verksamhet already has
   * at most one draft per source and day, and asking for a second gets the
   * first. The dialog says so before the button is pressed, and the message
   * afterwards says which of the two happened.
   */
  async function createReport(request: NewReportRequest) {
    const done = await mutate<{ id: string; created: boolean }>("/api/income/reports", {
      key: "newReport",
      body: request,
      error: t("newReport.failed"),
    });
    if (!done) return;
    notify.success(done.created ? t("newReport.done") : t("newReport.opened"));
    setNewFor(null);
    // Straight to it, in the single-day view: it is empty, and what happens next
    // is dragging sales onto it from the day beside it.
    setSelectedId(done.id);
    setMode("review");
  }

  /**
   * Remove a report that holds nothing.
   *
   * Only offered while it is empty, which is the state one made by mistake is
   * in: the wrong verksamhet picked, or a day that turned out not to need
   * splitting. It holds no lines, no total and no verifikation, so there is
   * nothing to lose and nothing to explain; the route lets bookkeeping do this
   * one without a skattmästare for exactly that reason.
   */
  async function deleteEmptyReport(report: IncomeReportRow) {
    const ok = await confirm({
      title: t("newReport.deleteTitle"),
      message: t("newReport.deleteBody", {
        unit: report.unitName ?? "",
        date: formatDate(report.date),
      }),
      confirmLabel: t("newReport.deleteConfirm"),
      tone: "danger",
    });
    if (!ok) return;

    const done = await mutate(`/api/income/reports/${report.id}`, {
      key: `delete-${report.id}`,
      method: "DELETE",
      error: t("newReport.deleteFailed"),
      success: t("newReport.deleteDone"),
    });
    if (!done) return;
    advance(report.id);
  }

  /**
   * Move a whole day to another verksamhet, from the field that names it.
   *
   * The common correction, and the one the review screen should make cheap: a
   * verksamhet that sold everything without its prefix has its entire day in
   * the fallback, and there is nothing to pick through. The day is simply
   * somebody else's.
   *
   * It happens on the pick, with two exceptions worth the interruption. If the
   * destination already has a report for this day the two become one, and no
   * later action can pull them apart again, because the lines keep no record of
   * which report they arrived on, so that one is asked first. And the accounts are
   * left as they are unless the destination has exactly one (`suggestedAccount`,
   * the same rule a drop follows), because guessing between a unit's beer and
   * its food would be a voucher that looks decided and is not. They are
   * corrected afterwards, in the table, where the account column is a picker.
   */
  async function changeUnit(report: IncomeReportRow, toResultUnitId: string) {
    if (!toResultUnitId || toResultUnitId === report.resultUnitId) return;

    const merging = drafts.find(
      (d) =>
        d.id !== report.id &&
        d.date === report.date &&
        d.source === report.source &&
        d.resultUnitId === toResultUnitId,
    );
    const unit = moveTargets.find((u) => u.resultUnitId === toResultUnitId);
    if (merging) {
      const ok = await confirm({
        title: t("move.mergeTitle", { unit: unit?.name ?? "" }),
        message: t("move.mergeBody", {
          count: report.lines.length,
          unit: unit?.name ?? "",
          date: formatDate(report.date),
        }),
        confirmLabel: t("move.mergeConfirm"),
      });
      if (!ok) return;
    }

    await move(report, {
      toResultUnitId,
      lines: report.lines.map((line) => {
        const account = suggestedAccount(unit, line.account);
        return account === line.account ? { id: line.id } : { id: line.id, account };
      }),
    });
  }

  /**
   * Which cost centre this day books against.
   *
   * The report's own field, and the one thing about a fetched day that review
   * was always meant to be able to change (see the note on UpdateIncomeReport).
   * It simply had nowhere to be changed from. The voucher's rows carry a cost
   * centre too, and editing one there books the day correctly exactly once:
   * the verifikation gets it, this field does not, and the queue, the booked
   * list and the next reopen all go on showing what the day had before. So the
   * decision is made here, where the day's identity is stated, and the rows
   * follow it.
   *
   * Cleared with the picker's own "clear" row, which is a state the day can
   * legitimately be in. Booking then falls back to the verksamhet's default,
   * and refuses if there is none.
   */
  async function setCostCentre(report: IncomeReportRow, code: string) {
    const done = await mutate(`/api/income/reports/${report.id}`, {
      key: `costCentre-${report.id}`,
      method: "PATCH",
      body: { costCenterId: costCenters.find((c) => c.code === code)?.id ?? null },
      error: t("costCentreFailed"),
    });
    if (!done) return;
    // The rows are derived from this, so an edit made before it is an opinion
    // about a distribution that no longer exists, the same as re-accounting a line.
    setEdits((e) => Object.fromEntries(Object.entries(e).filter(([id]) => id !== report.id)));
  }

  /**
   * Change which account a line books to, where it sits.
   *
   * Saved as it is picked rather than collected into a form: it is one value
   * with one obvious meaning, and the day beside it re-renders from it.
   */
  async function setLineAccount(report: IncomeReportRow, lineId: string, account: string) {
    await mutate(`/api/income/reports/${report.id}/lines`, {
      key: `account-${lineId}`,
      method: "PATCH",
      body: { lines: [{ id: lineId, account }] },
      error: t("lines.accountFailed"),
    });
    // The voucher rows are derived from the lines' accounts, so an edit made
    // before this one is about a distribution that no longer exists.
    setEdits((e) => Object.fromEntries(Object.entries(e).filter(([id]) => id !== report.id)));
  }

  /**
   * Book every day that is ready, one at a time and in order.
   *
   * Sequential on purpose. Each book renders and stores a PDF, and the service
   * caps how many renders run at once. Firing a hundred at it would queue them
   * behind that cap anyway, but with a hundred open requests and no way to say
   * how far it got. In order, a failure halfway is "these are done, that one
   * stopped it".
   *
   * No bodies: each day is booked as the app derives it. A day someone has
   * edited is theirs to book, deliberately, with the button in the editor.
   */
  const bookable = drafts.filter(
    (d) =>
      costCentreFor(d, settings) &&
      !isEdited(d) &&
      !d.duplicateOf &&
      // A report waiting to be filled has nothing to book: the server answers
      // "noDistributions" and this loop stops at it, which would make one empty
      // day left open on the screen a reason none of the days after it got
      // booked.
      d.lines.length > 0,
  );
  async function bookAll() {
    const ok = await confirm({
      title: t("bookAll.title"),
      message: t("bookAll.body", { count: bookable.length }),
      confirmLabel: t("bookAll.confirm"),
    });
    if (!ok) return;

    let done = 0;
    for (const report of bookable) {
      const result = await mutate(`/api/income/reports/${report.id}/book`, {
        key: "bookAll",
        error: t("bookFailed"),
        // One notification at the end, not one per day.
        refresh: false,
      });
      if (!result) break;
      done++;
    }
    notify.success(t("bookAll.done", { count: done, total: bookable.length }));
    // Refreshed once, after the loop. See the `refresh: false` above.
    window.location.reload();
  }

  // One button, wherever the queue is being shown: the sidebar in "granska",
  // the card header in "tabell". Absent rather than disabled when there is
  // nothing it would do: a day that needs a cost centre or has been edited is
  // one somebody has to open anyway, and a permanently greyed control on a
  // screen you look at a hundred times is furniture.
  const bookAllButton = bookable.length > 0 && (
    <Button size="sm" variant="secondary" onClick={bookAll} loading={pending === "bookAll"}>
      {t("bookAll.action", { count: bookable.length })}
    </Button>
  );

  // The table view of the working set: every fetched day at once, with the two
  // decisions available on each without leaving it.
  const tableColumns = reviewColumns({
    t,
    settings,
    formatDate,
    pending,
    onOpen: (r) => {
      setSelectedId(r.id);
      setMode("review");
    },
    onBook: book,
  });

  const voucher = selected ? voucherFor(selected) : null;
  // A report waiting for sales to be moved onto it. It has no intäktsräkning
  // and no voucher, since both are derived from lines it does not have, so the
  // middle column says what it is for instead of showing empty versions of them.
  const isEmpty = Boolean(selected && selected.lines.length === 0);
  /**
   * Which payment method a new report for this day would be for.
   *
   * Read off the day rather than asked, and there is only ever one answer to
   * read: a fetch clears every unbooked report before storing what it brought
   * back (lib/income/batch.ts), so the whole queue is one fetch, Zettle or
   * Swish, never both. The day's own reports answer it, and the fetch behind
   * them stands in for a day that holds nothing but Zettle's fees, which are
   * nobody's takings and not a source a report can be made for.
   */
  function sourceFor(reports: readonly IncomeReportRow[]): NewReportSource {
    const sold = reports.find((r) => r.source !== "ZETTLE_FEE")?.source;
    if (sold && sold !== "ZETTLE_FEE") return sold;
    return queue.batch?.source === "SWISH" ? "SWISH" : "ZETTLE";
  }
  // Moving lines corrects where a fetch put them, so it is offered on days that
  // are still drafts, which is every day in this queue, and never on Zettle's
  // own fees, which are nobody's takings and have no verksamhet to move to.
  const canMove = Boolean(
    selected &&
      selected.source !== "ZETTLE_FEE" &&
      selected.resultUnitId &&
      selected.lines.length > 0 &&
      moveTargets.some((u) => u.resultUnitId !== selected.resultUnitId),
  );
  // Read rather than kept in step: a selection belongs to the day it was made
  // on, so on any other day there is none.
  const picked = selection.reportId === selected?.id ? selection.lineIds : [];
  const moveOpen = Boolean(selected && moveFor === selected.id);
  const pick = (lineIds: string[]) =>
    selected && setSelection({ reportId: selected.id, lineIds });
  // What the account column offers: this day's own verksamhet's accounts first,
  // then the chart. Same list, same order, as the move dialog's.
  const lineAccountOptions = accountOptions(
    moveTargets.find((u) => u.resultUnitId === selected?.resultUnitId),
    accounts,
    t("move.unknownAccountName"),
  );

  // The chart of cost centres, as the picker beside the verksamhet offers them.
  const costCentreOptions = costCenters.map((c) => ({
    value: c.code,
    label: `${c.code} – ${c.name}`,
    short: c.code,
  }));

  // Every verksamhet still taking money in, including this day's own. The
  // picker holds the current value, so leaving it out would leave the field
  // showing a placeholder for a day that plainly belongs to somebody. A unit
  // whose income settings were removed after the fetch is not in the list at
  // all, so it is added back here rather than reading as unassigned.
  const unitOptions = [
    ...moveTargets.map((u) => ({ value: u.resultUnitId, label: u.name })),
    ...(selected?.resultUnitId && !moveTargets.some((u) => u.resultUnitId === selected.resultUnitId)
      ? [{ value: selected.resultUnitId, label: selected.unitName ?? selected.resultUnitId }]
      : []),
  ];

  // Dragging lines onto another day in the queue. See ./use-line-drag.
  const { dragging, startDrag, endDrag, dropOn, isDropTarget, dropProps } = useLineDrag({
    drafts,
    moveTargets,
    onMove: move,
  });

  // The days, grouped by the day they were sold, which is what a heading in a
  // queue of takings should say.
  const groups: { date: string; reports: IncomeReportRow[] }[] = [];
  for (const report of drafts) {
    const last = groups.at(-1);
    if (last?.date === report.date) last.reports.push(report);
    else groups.push({ date: report.date, reports: [report] });
  }

  return (
    <PageShell
      title={t("title")}
      description={t("review.description")}
      collections={incomeSections({
        active: "review",
        label: t("nav.label"),
        labels: { review: t("nav.review"), booked: t("nav.booked") },
        counts: { review: drafts.length },
      })}
    >
      {!serviceConfigured && (
        <Card>
          <CardBody>
            <p className="text-sm text-muted">{t("serviceUnavailable")}</p>
          </CardBody>
        </Card>
      )}

      {/* The document belongs to whichever day is selected; the shell stands it
          beside all of this, full height. */}
      <ReceiptPanelSource
        // Nothing to render for a report with no lines. The intäktsräkning is
        // a rendering of what was sold, and it is waiting for some.
        documentUrl={selected && !isEmpty ? documentUrl(selected) : null}
        mimeType="application/pdf"
        filename={
          selected ? `${t(`source.${selected.source}`)} – ${formatDate(selected.date)}` : undefined
        }
      />

      {/* The screen's own toolbar: what fills the queue, and how the queue is
          drawn. Both are about this working set rather than about a report in
          it, so they sit above the whole thing rather than in any list's
          header, and the fetch button is here rather than in the page header
          because what it does is reveal the panel directly below it.

          The view toggle is the icon register (components/ui/view-toggle.tsx)
          and is absent when there is nothing to draw; the fetch button never
          is, because an empty queue is exactly when you want it. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setFetchOpen((v) => !v)}
          aria-expanded={fetchOpen}
        >
          <IconDownload className="size-4" />
          {t("fetch.title")}
        </Button>
        {drafts.length > 0 && (
          <ViewToggle
            value={mode}
            onChange={(v) => setMode(v)}
            aria-label={t("review.viewLabel")}
            options={[
              { value: "review", label: t("review.modeReview"), icon: IconViewSplit },
              { value: "table", label: t("review.modeTable"), icon: IconViewTable },
            ]}
          />
        )}
      </div>

      {fetchOpen && <FetchPanel serviceConfigured={serviceConfigured} />}

      {drafts.length === 0 ? (
        <EmptyState title={t("empty.title")} description={t("empty.description")} />
      ) : mode === "table" ? (
        <Card>
          <CardHeader
            title={t("review.modeTable")}
            subtitle={t("counts.reports", { count: drafts.length })}
            action={bookAllButton}
          />
          <ClientDataTable
            columns={tableColumns}
            rows={drafts}
            controls={controls}
            searchPlaceholder={t("booked.searchPlaceholder")}
            rowKey={(r) => r.id}
            rowClassName={(r) => cn(isDuplicate(r) && "bg-warning-soft")}
            empty={t("empty.noMatch")}
          />
        </Card>
      ) : (
        // Side by side only from xl, not lg. This screen is three columns, not
        // two: the queue, the detail, and the shell's document panel, and that
        // last one is 520px by default and open on this page, because the whole
        // point is reading the intäktsräkning against the voucher. At lg that
        // left the detail column about 130px wide (1024 − 520 panel − 64 page
        // gutters − 280 queue and gap − 32 card padding), which is narrower
        // than a single one of the fields inside it. Stacked, the detail gets
        // the full main column instead, and the queue is a list above it.
        <div className="flex flex-col gap-6 xl:flex-row">
          {/* Matching the row above: the panel's default becomes a fixed column
              at lg, which here would be a 16rem card stranded above a detail
              that is still stacked under it.

              Sticky from xl, where it is a column beside the detail rather than
              a list above it. The detail is the long thing on this screen, since
              a day's sales can be a hundred rows, and the queue scrolling away
              with it meant that picking the next day was a scroll back to the
              top every time, on the one screen whose whole job is going through
              a list of days one after another.

              `self-start` is what makes that work at all: the row stretches its
              items by default, so the panel was already as tall as the detail
              beside it, and a sticky box that is as tall as its own scroll
              range has nothing to stick for. */}
          <SidebarPanel
            at="xl"
            className="xl:sticky xl:top-8 xl:self-start"
            sheetLabel={t("counts.reports", { count: drafts.length })}
            // The day being reviewed, as the row in the queue states it: the
            // verksamhet, the day it is for, and what it comes to. Below xl the
            // queue is a dialog behind this bar rather than 364px of list above
            // the report. See components/ui/sidebar-list.tsx.
            bar={
              selected ? (
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {selected.unitName ?? t("table.fees")}
                    <span className="ml-1.5 text-xs text-muted">
                      {formatDate(selected.date)}
                    </span>
                  </span>
                  <Amount value={selected.total} />
                </span>
              ) : (
                t("counts.reports", { count: drafts.length })
              )
            }
          >
            {/* What the queue holds, and the one thing you can do to all of it.
                The same pair the table view puts in its card header. This is
                the same list in the other shape, and a bulk action belongs to
                the list it books rather than to the page around it. */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <span className="text-sm font-medium">
                {t("counts.reports", { count: drafts.length })}
              </span>
              {bookAllButton}
            </div>
            {/* The scrollbar floats over the rows rather than taking a column
                from them. See components/ui/overlay-scroll.tsx. In a 16rem
                panel whose rows are a name against an amount, the gutter was
                worth removing. */}
            {/* Stacked above the detail, this is 70% of the screen you have to
                scroll past before reaching the day you just picked, so while
                it is a list on top, it is a short one.

                As a sticky column it is the opposite: the panel now holds its
                own position, so the height it takes is height it keeps, and the
                right amount is as much of the screen as it can have. The 8rem
                is the 2rem it sticks at plus the panel's own header, and enough
                left under it that the card ends visibly rather than running off
                the bottom edge. */}
            <OverlayScroll className="max-h-80 xl:max-h-[calc(100dvh-8rem)]">
              {groups.map((group) => (
                <div key={group.date}>
                  {/* The heading carries the day's own action: a report for a
                      verksamhet this day produced none for, so that a fallback
                      day belonging to two of them can be split in two. Here
                      rather than at the top of the page because the day it
                      would be for is the heading it sits on. Nothing to pick,
                      nothing to type, and it is beside the very rows the sales
                      would be dragged out of. */}
                  <SidebarGroupLabel
                    action={
                      <button
                        type="button"
                        onClick={() =>
                          setNewFor({ date: group.date, source: sourceFor(group.reports) })
                        }
                        title={t("newReport.action")}
                        aria-label={t("newReport.actionFor", { date: formatDate(group.date) })}
                        className="-my-1 flex size-6 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-accent-soft hover:text-accent"
                      >
                        <IconPlus className="size-3.5" />
                      </button>
                    }
                  >
                    {formatDate(group.date)}
                  </SidebarGroupLabel>
                  {group.reports.map((report) => (
                    <SidebarItem
                      key={report.id}
                      active={report.id === selected?.id}
                      onClick={() => setSelectedId(report.id)}
                      {...dropProps(report)}
                      className={cn(
                        // A day Fortnox already has a voucher for. Coloured
                        // rather than hidden: it may be a genuine second one,
                        // and that is the reviewer's call, but it must not be
                        // possible to book it without noticing.
                        isDuplicate(report) && "bg-warning-soft",
                        // While something is being dragged, say which rows
                        // would take it. Without this the queue is a list of
                        // days that all look equally droppable, and only the
                        // cursor, briefly at the moment of release,
                        // distinguishes the ones that are.
                        dragging && isDropTarget(report) && "ring-1 ring-inset ring-accent/40",
                        dragging && !isDropTarget(report) && "opacity-40",
                        dropOn === report.id && "bg-accent-soft ring-2 ring-inset ring-accent",
                      )}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          {isDuplicate(report) && (
                            <IconAlert className="size-3.5 shrink-0 text-warning" />
                          )}
                          <span className="truncate font-medium">
                            {report.unitName ?? t("table.fees")}
                          </span>
                        </span>
                        <Amount value={report.total} />
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {t(`source.${report.source}`)}
                        {/* The one thing that stops a day being bookable, said
                            in the list so it can be found without opening every
                            day to look. A day standing on its committee's
                            default is not one of them. */}
                        {!costCentreFor(report, settings) && ` – ${t("review.noCostCenter")}`}
                        {isEdited(report) && ` – ${t("review.edited")}`}
                        {report.duplicateOf && ` – ${t("review.alreadyBookedShort")}`}
                        {report.existingVoucher && ` – ${report.existingVoucher}`}
                      </p>
                    </SidebarItem>
                  ))}
                </div>
              ))}
            </OverlayScroll>
          </SidebarPanel>

          {selected && voucher && (
            // A container, because nothing else in this column can know how
            // wide it is. The document panel beside it is dragged to whatever
            // width the reader wants (360px to 70vw, remembered in a cookie),
            // so the detail's width is not a function of the viewport's and a
            // `sm:`/`lg:` breakpoint here is guessing. What the fields inside
            // respond to is this box. See the grid below.
            <div className="@container min-w-0 flex-1 space-y-6">
              {/* What the voucher is: its own card, a gap above the rows that
                  say what it books, exactly as the utlägg booking view has it.
                  Both fields are locked, and not merely disabled-looking: the
                  date is which day was sold, and the text is what the Fortnox
                  duplicate check matches on together with it
                  (lib/income/duplicate.ts). */}
              {/* Named where the decision is made, not only in the list. */}
              <AlreadyBookedNotice report={selected} t={t} />

              <Card>
                <CardBody
                  className={cn(
                    "grid gap-5",
                    // Every track is a minmax with a floor of 0, so a column
                    // that has run out of room shrinks instead of pushing the
                    // card open. The old `150px`/`140px` were rigid: four of
                    // them wanted 542px however little there was, which is how
                    // a 250px detail column ended up with fields hanging out
                    // over the page.
                    //
                    // Two up as soon as there is room for two, four only when
                    // the last column would still be worth having. Below that
                    // the voucher text was a 30px box with an ellipsis in it.
                    canMove
                      ? "@md:grid-cols-2 @4xl:grid-cols-[minmax(0,12rem)_minmax(0,10rem)_minmax(0,9rem)_minmax(0,1fr)]"
                      : "@md:grid-cols-2 @3xl:grid-cols-[minmax(0,10rem)_minmax(0,9rem)_minmax(0,1fr)]",
                  )}
                >
                  {/* Whose takings the day is, stated where the rest of its
                      identity is stated, and changed the same way. Picking
                      another verksamhet moves every line onto that unit's
                      report for this day, which is the whole-day case of the
                      move the table below does line by line.

                      The two at the end are locked because they are not
                      anybody's choice: the date is which day was sold, and the
                      text is how the day is recognised in Fortnox. The two
                      before them are decisions, whose takings these were and
                      where they book, and both of them are what the voucher
                      below is derived from. */}
                  {canMove && (
                    <Field label={t("move.unitField")}>
                      <Combobox
                        options={unitOptions}
                        value={selected.resultUnitId ?? ""}
                        onChange={(v) => changeUnit(selected, v)}
                        disabled={busy}
                        aria-label={t("move.unitField")}
                      />
                    </Field>
                  )}
                  {/* The day's own cost centre, not the voucher's rows: change
                      it here and every row follows, which is the difference
                      between a day that is booked against it and a voucher that
                      happens to mention it. Shown at what it would book against
                      today: its own if it has one, else its verksamhet's
                      default, which is the order the booking route falls back
                      in as well. */}
                  <Field label={t("table.costCenter")}>
                    <Combobox
                      options={costCentreOptions}
                      value={costCentreFor(selected, settings)}
                      onChange={(v) =>
                        v !== costCentreFor(selected, settings) && setCostCentre(selected, v)
                      }
                      disabled={busy}
                      allowClear
                      placeholder={t("review.noCostCenter")}
                      aria-label={t("table.costCenter")}
                    />
                  </Field>
                  <Field label={tBook("voucherDate")}>
                    <div className="flex h-11 w-full items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-sm text-muted sm:h-9">
                      <IconLock className="size-3.5 shrink-0" />
                      <span className="tabular-nums">{selected.date}</span>
                    </div>
                  </Field>
                  <Field label={tBook("voucherText")}>
                    <div className="flex h-11 w-full items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-sm text-muted sm:h-9">
                      <IconLock className="size-3.5 shrink-0" />
                      <span className="truncate">
                        {incomeVoucherDescription(selected.source, selected.unitDescription)}
                      </span>
                    </div>
                  </Field>
                </CardBody>
              </Card>
              {/* A report made by hand and not yet filled: created for a
                  verksamhet the routing produced no day for, so that a fallback
                  day belonging to two of them can be split in two. Neither the
                  voucher nor the sold-lines table is shown, because both are
                  derived from lines it has none of. What it says instead is
                  what to do with it. */}
              {isEmpty ? (
                <EmptyReportCard
                  t={t}
                  onDelete={() => deleteEmptyReport(selected)}
                  deleting={pending === `delete-${selected.id}`}
                />
              ) : (
                <>
                  <VoucherCard
                    voucher={voucher}
                    accounts={accounts}
                    costCenters={costCenters}
                    onRows={(rows) => setRows(selected, rows)}
                    onBook={() => book(selected)}
                    booking={pending === `book-${selected.id}`}
                    t={t}
                  />

                  {/* What was sold, which is what the intäktsräkning beside this is
                      a rendering of. Below the voucher rather than beside it: the
                      voucher is the thing being decided, this is the backing. */}
                  <Card>
                    <CardHeader title={t("review.lines")} />
                    {/* A plain div, not a CardBody with its padding turned off:
                        `cn` is a joiner rather than tailwind-merge, so a `p-0`
                        passed to CardBody does not replace its `px-inset py-5`.
                        Both land in the class attribute and Tailwind's own order
                        decides, which it does in favour of the more specific
                        padding. The table is meant to run to the card's edges, so
                        it is wrapped in something that has no padding to begin
                        with. Same as DataTable, which puts its rows straight into
                        the Card. */}
                    {/* TableScroll, not a bare `overflow-x-auto`: with nothing
                        setting a floor, a `w-full` table always fits its box,
                        so the scroller never engaged and six columns, one of
                        them an account picker, squeezed down to a few
                        characters each instead. Same treatment as the voucher
                        editor directly above, which has scrolled at its own
                        600px all along. */}
                    {/* 7rem lighter than it was, all of it out of the account
                        column below. Every other column keeps the floor it
                        had. */}
                    <TableScroll minWidth={canMove ? "min-w-[35rem]" : "min-w-[31rem]"}>
                      <table className="w-full text-sm">
                        <thead className="border-b border-border bg-surface/40 text-left text-xs text-muted">
                          <tr>
                            {canMove && (
                              <>
                                {/* The grip's column, outermost. It is what you
                                    reach for to pick the row up, and a handle
                                    inside the selection column reads as part of
                                    the checkbox. */}
                                <th className="w-6 pl-3" />
                                <th className="w-8 py-2 pl-2">
                                  {/* A checkbox is an inline box, so it sits on the
                                      cell's text baseline with the line's descender
                                      space under it, which centring the *cell*
                                      cannot fix, because the box is where it was
                                      put inside it. A flex wrapper takes it off the
                                      baseline, the same way the grip beside it is
                                      laid out. */}
                                  <span className="flex items-center">
                                    <input
                                      type="checkbox"
                                      className="size-4 accent-accent"
                                      checked={
                                        picked.length > 0 && picked.length === selected.lines.length
                                      }
                                      // Half a selection is neither state the box has,
                                      // and the dash is what says so.
                                      ref={(el) => {
                                        if (el) {
                                          el.indeterminate =
                                            picked.length > 0 && picked.length < selected.lines.length;
                                        }
                                      }}
                                      onChange={(e) =>
                                        pick(e.target.checked ? selected.lines.map((l) => l.id) : [])
                                      }
                                      aria-label={t("move.selectAll")}
                                    />
                                  </span>
                                </th>
                              </>
                            )}
                            <th className="px-3 py-2 font-medium">{t("lines.product")}</th>
                            {/* The picker under this only ever shows the account
                                number. `accountOptions` gives every option a
                                `short` of exactly that, and the trigger prefers
                                it (components/ui/combobox.tsx). So the column
                                was 14rem of box around four digits, taken from
                                the product names next to it, which are the ones
                                that actually run long. 7rem fits "3001" with
                                room to spare.

                                The menu does not shrink with it: it floors at
                                240px of its own, so the full "3001 – Försäljning
                                (prefixes)" is still what you pick from. */}
                            <th className="w-28 px-3 py-2 font-medium">{t("lines.account")}</th>
                            <th className="px-3 py-2 text-right font-medium">{t("lines.quantity")}</th>
                            <th className="px-3 py-2 text-right font-medium">{t("lines.unitPrice")}</th>
                            <th className="px-3 py-2 text-right font-medium">{t("lines.total")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {productRows(selected.lines).map((row) =>
                            row.kind === "group" ? (
                              // The product said once, with its variants stepped
                              // in beneath, exactly as the intäktsräkning in the
                              // panel beside this lays them out. See
                              // lib/income/product-groups.ts.
                              <tr key={row.key} className="[&>td]:align-middle">
                                {canMove && <td colSpan={2} />}
                                <td colSpan={5} className="px-3 pb-2 pt-2 font-medium">
                                  {row.name}:
                                </td>
                              </tr>
                            ) : (
                            // `group` so the drag handle appears on hover. See
                            // components/ui/drag.tsx.
                            <tr
                              key={row.key}
                              className={cn(
                                "group",
                                // A cell aligns on its first line's baseline by
                                // default, and the account picker is a good deal
                                // taller than a line of text, so the product, the
                                // quantity and the amounts all sat high against it.
                                // Set on the row rather than on six cells:
                                // vertical-align is not inherited, so it has to
                                // name them.
                                "[&>td]:align-middle",
                                // What is currently in flight, so it is clear which
                                // rows a drop is about when several were checked.
                                dragging?.lineIds.includes(row.line.id) && "opacity-40",
                              )}
                            >
                              {canMove && (
                                <>
                                  <td className="py-2 pl-3">
                                    <DragHandle
                                      title={t("move.dragHint")}
                                      className="flex items-center text-muted/40 hover:text-muted"
                                      onDragStart={(e) => {
                                        // Dragging a checked row takes the whole
                                        // selection; dragging an unchecked one is
                                        // about that row alone, and does not
                                        // disturb whatever is checked.
                                        const lineIds = picked.includes(row.line.id)
                                          ? picked
                                          : [row.line.id];
                                        e.dataTransfer.setData(
                                          "incomeLines",
                                          JSON.stringify({ reportId: selected.id, lineIds }),
                                        );
                                        e.dataTransfer.effectAllowed = "move";
                                        startDrag(selected.id, lineIds);
                                      }}
                                      onDragEnd={endDrag}
                                    />
                                  </td>
                                  <td className="py-2 pl-2">
                                    {/* Off the baseline. See the header's box. */}
                                    <span className="flex items-center">
                                      <input
                                        type="checkbox"
                                        className="size-4 accent-accent"
                                        checked={picked.includes(row.line.id)}
                                        onChange={() =>
                                          pick(
                                            picked.includes(row.line.id)
                                              ? picked.filter((id) => id !== row.line.id)
                                              : [...picked, row.line.id],
                                          )
                                        }
                                        // The whole name, not the row's label:
                                        // out of the table "Ost" is not a
                                        // product, and a checkbox announced on
                                        // its own has no heading above it.
                                        aria-label={t("move.selectLine", {
                                          product: productDisplayName(row.line),
                                        })}
                                      />
                                    </span>
                                  </td>
                                </>
                              )}
                              <td className="px-3 py-2">
                                {row.indented ? (
                                  <span className="flex items-center gap-1.5 pl-4">
                                    {/* The same elbow the document draws. */}
                                    <IconElbow className="size-3.5 shrink-0 text-muted/60" />
                                    {row.label}
                                  </span>
                                ) : (
                                  row.label
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {/* Editable in place. A sale that fell to the
                                    fallback is on the fallback's account, and that
                                    is as likely to be what needs correcting as the
                                    report it landed in. See lib/income/lines.ts. */}
                                <Combobox
                                  options={lineAccountOptions}
                                  value={row.line.account}
                                  onChange={(v) =>
                                    v !== row.line.account &&
                                    setLineAccount(selected, row.line.id, v)
                                  }
                                  disabled={busy}
                                  aria-label={t("lines.accountFor", {
                                    product: productDisplayName(row.line),
                                  })}
                                />
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {row.line.quantity}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <Amount value={row.line.unitPrice} />
                              </td>
                              <td className="px-3 py-2 text-right">
                                <Amount value={row.line.total} />
                              </td>
                            </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </TableScroll>
                    {/* Only once something is picked: an action bar on a day nobody
                        is correcting is a row of controls to read past. */}
                    {canMove && picked.length > 0 && (
                      <CardBody className="flex flex-wrap items-center justify-between gap-3 border-t border-border">
                        <span className="text-sm text-muted">
                          {t("move.picked", { count: picked.length })}
                        </span>
                        <div className="flex items-center gap-2.5">
                          <Button onClick={() => setMoveFor(selected.id)}>{t("move.action")}</Button>
                        </div>
                      </CardBody>
                    )}
                  </Card>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {moveOpen && selected && (
        <MoveLinesDialog
          report={selected}
          lines={selected.lines.filter((l) => picked.includes(l.id))}
          targets={moveTargets}
          accounts={accounts}
          busy={pending === `move-${selected.id}`}
          onCancel={() => setMoveFor(null)}
          onMove={(request) => move(selected, request)}
        />
      )}

      {newFor && (
        <NewReportDialog
          targets={moveTargets}
          reports={drafts}
          date={newFor.date}
          source={newFor.source}
          dateLabel={formatDate(newFor.date)}
          busy={pending === "newReport"}
          onCancel={() => setNewFor(null)}
          onCreate={createReport}
        />
      )}
    </PageShell>
  );
}
