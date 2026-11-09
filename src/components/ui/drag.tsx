"use client";

// HTML5 drag and drop is mouse-only: a drag is never the only way to do something.
import { cn } from "@/lib/ui/utils";

/** The grip you pick a row up by (a handle, so clicks into cells are not drags). The parent row must carry `group`.
 * `onDragStart` is HTML5 drag and drop onto targets; `onPointerDown` is a pointer drag for a row that follows the cursor. */
export function DragHandle({
  onDragStart,
  onDragEnd,
  onPointerDown,
  title,
  className,
}: {
  onDragStart?: (e: React.DragEvent) => void;
  /** Fires however the drag ended (dropped, Escape, over nothing): clear drop highlights here, not on drop. */
  onDragEnd?: (e: React.DragEvent) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  title: string;
  className?: string;
}) {
  return (
    <span
      // Only for the HTML5 kind: left on for the other, the browser's drag starts on top of the pointer drag.
      draggable={onDragStart ? true : undefined}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onPointerDown={onPointerDown}
      title={title}
      aria-hidden
      className={cn(
        "cursor-grab select-none opacity-0 transition-opacity active:cursor-grabbing group-hover:opacity-100",
        // A touch on the grip is a drag, not a scroll.
        onPointerDown && "touch-none",
        className,
      )}
    >
      ⠿
    </span>
  );
}
