"use client";

// The app's drag-and-drop idiom, in one place.
//
// Both places that drag things — the budget sheet (reorder a line, reclassify
// an account) and the income review screen (move a day's sold lines onto
// another verksamhet) — are plain HTML5 drag and drop rather than a library.
// That is the right call for what they do: a handful of draggables onto a
// handful of targets, no sortable list semantics, no pointer-event polyfill.
//
// What was worth sharing is what the two had copied: the grip, and the rule for
// when a drop highlight goes away.
//
// Both of these are mouse-only, which HTML5 drag and drop simply is. Neither
// screen relies on it: the budget's ordering can be edited, and a line can be
// moved with the checkboxes and the dialog. A drag is a shortcut for people who
// have a mouse in their hand, and never the only way to do something.
import { cn } from "@/lib/ui/utils";

/**
 * True while the drag pointer is still inside the element's box.
 *
 * Used to keep a drop highlight from flashing: `dragleave` fires every time the
 * pointer crosses onto a child element, so the highlight is only cleared when
 * the pointer has truly left.
 */
export function insideRect(e: React.DragEvent): boolean {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom;
}

/**
 * The grip you pick a row up by: ⠿, faint until the row is hovered.
 *
 * A handle rather than a draggable row, in both screens and for the same
 * reason: the rows are full of things you click into — a formula cell, an
 * account picker, a checkbox — and a row that is itself draggable turns every
 * imprecise click on one of those into a drag.
 *
 * Two ways to pick something up, and the props decide which. `onDragStart` is
 * HTML5 drag and drop, for dropping a thing onto another thing — an account
 * onto a section, a day's lines onto a verksamhet. `onPointerDown` is a plain
 * pointer drag, for a row that has to follow the pointer as it goes: HTML5
 * reports where you are over, not where you are, and it never hands over the
 * cursor's position between one row and the next.
 *
 * The parent row must carry `group` for the hover reveal to work.
 */
export function DragHandle({
  onDragStart,
  onDragEnd,
  onPointerDown,
  title,
  className,
}: {
  onDragStart?: (e: React.DragEvent) => void;
  /**
   * Fires however the drag ended — dropped, cancelled with Escape, or let go
   * over nothing. Anything that lit up while the drag was in flight has to be
   * put out here rather than on drop, which does not happen for the other two.
   */
  onDragEnd?: (e: React.DragEvent) => void;
  /** The other kind of drag: the caller follows the pointer from here itself. */
  onPointerDown?: (e: React.PointerEvent) => void;
  /** What is being picked up, for the tooltip. */
  title: string;
  className?: string;
}) {
  return (
    <span
      // Only for the HTML5 kind. Left on for the other, the browser's own drag
      // starts on top of the pointer drag and the row is being moved twice.
      draggable={onDragStart ? true : undefined}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onPointerDown={onPointerDown}
      title={title}
      aria-hidden
      className={cn(
        "cursor-grab select-none opacity-0 transition-opacity active:cursor-grabbing group-hover:opacity-100",
        // A touch that starts on the grip is a drag, not a scroll — without
        // this the browser takes it for panning and the row never moves.
        onPointerDown && "touch-none",
        className,
      )}
    >
      ⠿
    </span>
  );
}
