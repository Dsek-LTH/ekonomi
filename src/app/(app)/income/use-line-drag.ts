"use client";

// Dragging lines of takings onto another day in the review queue.
//
// The shortcut for the ordinary case: a couple of mis-rung products, and the
// day they belong to is already on screen in the queue beside them. The drop
// moves them there and then, on the account the destination suggests, which
// for a verksamhet with several is the one they already had, so the account is
// put right afterwards in the table, where it is now editable. The
// checkbox-and-dialog path is still there, and is still the way to decide
// accounts first, do it from the keyboard, or move to a unit with no report
// that day (which has no row here to drop on).
//
// Its own hook because it is its own concern: two pieces of state and three
// handlers that nothing else on the screen reads, which were sitting in the
// middle of the component that draws the entire page.
import { useState } from "react";

import { insideRect } from "@/components/ui/drag";
import { suggestedAccount, type MoveRequest } from "./move-dialog";
import type { IncomeMoveTarget, IncomeReportRow } from "@/lib/data/income";

/**
 * The MIME-ish key the payload travels under.
 *
 * Every drop is gated on it, exactly as the budget sheet's targets are, so a
 * drag from anywhere else on the page is ignored rather than swallowed. The
 * DataTransfer API lower-cases the keys it reports in `types`, which is why the
 * two spellings below are both here and both correct.
 */
const PAYLOAD = "incomeLines";
const PAYLOAD_TYPE = PAYLOAD.toLowerCase();

export function useLineDrag({
  drafts,
  moveTargets,
  onMove,
}: {
  drafts: IncomeReportRow[];
  moveTargets: IncomeMoveTarget[];
  onMove: (from: IncomeReportRow, request: MoveRequest) => void | Promise<unknown>;
}) {
  // A drag in flight: which day the lines are being taken from, and which ones.
  // Held here rather than read out of the drag event, because the queue has to
  // know it during `dragover`, the one moment the DataTransfer will not let
  // anything read its payload.
  const [dragging, setDragging] = useState<{ reportId: string; lineIds: string[] } | null>(null);
  // The queue row the pointer is currently over, for the drop highlight.
  const [dropOn, setDropOn] = useState<string | null>(null);

  /** Where a dragged line may land: the same day and source, another verksamhet. */
  function isDropTarget(target: IncomeReportRow): boolean {
    const from = dragging && drafts.find((d) => d.id === dragging.reportId);
    if (!from) return false;
    return (
      target.id !== from.id &&
      target.date === from.date &&
      target.source === from.source &&
      Boolean(target.resultUnitId) &&
      target.resultUnitId !== from.resultUnitId
    );
  }

  function dropLines(target: IncomeReportRow, payload: string) {
    let dropped: { reportId: string; lineIds: string[] };
    try {
      dropped = JSON.parse(payload);
    } catch {
      return;
    }
    const from = drafts.find((d) => d.id === dropped.reportId);
    if (!from || !target.resultUnitId || !isDropTarget(target)) return;

    // The same suggestion the dialog opens on, applied without asking: one
    // account among the destination's prefixes is not a choice, and more than
    // one leaves the line where it is until someone says otherwise.
    const unit = moveTargets.find((u) => u.resultUnitId === target.resultUnitId);
    const lines = dropped.lineIds.flatMap((id) => {
      const line = from.lines.find((l) => l.id === id);
      if (!line) return [];
      const account = suggestedAccount(unit, line.account);
      return [account === line.account ? { id } : { id, account }];
    });
    if (lines.length === 0) return;

    void onMove(from, { toResultUnitId: target.resultUnitId, lines });
  }

  const dropProps = (report: IncomeReportRow) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(PAYLOAD_TYPE) || !isDropTarget(report)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dropOn !== report.id) setDropOn(report.id);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (insideRect(e)) return;
      setDropOn((id) => (id === report.id ? null : id));
    },
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(PAYLOAD_TYPE)) return;
      e.preventDefault();
      setDropOn(null);
      setDragging(null);
      dropLines(report, e.dataTransfer.getData(PAYLOAD));
    },
  });

  return {
    dragging,
    dropOn,
    isDropTarget,
    dropProps,
    /** A drag has begun, on these lines of this day. */
    startDrag: (reportId: string, lineIds: string[]) => setDragging({ reportId, lineIds }),
    /** It ended, however it ended: dropped, cancelled, or let go over nothing. */
    endDrag: () => {
      setDragging(null);
      setDropOn(null);
    },
  };
}
