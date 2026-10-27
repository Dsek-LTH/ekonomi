"use client";

// A scrolling box whose scrollbar floats over the content instead of taking a
// column away from it.
//
// The income queue is the reason. Its rows are a verksamhet's name on the left
// and the day's takings on the right, in a 16rem column beside the workbench,
// and a native scrollbar is 11-15px of that column, permanently, so every row
// was laid out inside a narrower box than the panel it sits in. macOS hides its
// scrollbars until you scroll and has never had this problem; Windows and Linux
// do, which is most of the section.
//
// So the native one is hidden and this draws its own: absolutely placed beside
// the content rather than beside the *box*, translucent, and blurred over
// whatever it happens to cross. It sits inside the rows' own 16px padding, so
// in practice it crosses nothing. What it buys is the 11px, on every row.
//
// It is a real scrollbar, not a picture of one: it can be dragged, and it is
// hidden while there is nothing to scroll. What it deliberately does not do is
// take over the page. This is for a panel whose width is worth arguing about,
// and the document scrollbar is left alone.
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/ui/utils";

/** How far the thumb sits from the top, bottom and right of the box. */
const INSET = 4;
/** Below this the thumb is a dot nobody can grab. */
const MIN_THUMB = 28;

export function OverlayScroll({
  className,
  frameClassName,
  children,
}: {
  /** The box itself, its height cap above all: `max-h-[70vh]`. */
  className?: string;
  /**
   * The frame around the box, which carries the floating thumb. Only for a box
   * that takes its height from a flex column rather than from a cap: the frame
   * is the flex item, so it is the frame that has to grow and shrink. The
   * budget's cost-centre list does this from lg.
   */
  frameClassName?: string;
  children: React.ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  // Null while there is nothing to scroll, which is also when nothing is drawn.
  // Only the *height* is state: it is a function of how much there is to
  // scroll, so it changes when the box or its contents change and at no other
  // time. Where the thumb sits changes on every frame of a scroll, and that is
  // deliberately not state. See `position`.
  const [thumb, setThumb] = useState<{ height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  // What `position` needs to do its arithmetic without touching the DOM for it.
  const track = useRef({ travel: 0, scrollable: 0 });

  /**
   * Move the thumb to where the box is currently scrolled to.
   *
   * Straight to the node, not through state. This runs on every scroll event,
   * once a frame while a wheel or a thumb-drag is in flight, and a `setState`
   * there re-rendered this component for each one; it measured at roughly a
   * millisecond of scripting per pointermove while the thumb was being
   * dragged, for a bar 6px wide. A transform also keeps it off the layout
   * path, so the browser composites it rather than laying the panel out again.
   */
  const position = useCallback(() => {
    const el = scrollRef.current;
    const node = thumbRef.current;
    if (!el || !node) return;
    const { travel, scrollable } = track.current;
    const progress = scrollable > 0 ? el.scrollTop / scrollable : 0;
    node.style.transform = `translateY(${INSET + progress * travel}px)`;
  }, []);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollHeight, clientHeight } = el;
    // The +1 absorbs the sub-pixel difference a fractional layout leaves
    // behind, which would otherwise draw a full-height thumb on a box that
    // does not scroll.
    if (scrollHeight <= clientHeight + 1) {
      setThumb(null);
      return;
    }
    const length = clientHeight - INSET * 2;
    const height = Math.max(MIN_THUMB, (clientHeight / scrollHeight) * length);
    track.current = { travel: length - height, scrollable: scrollHeight - clientHeight };
    // Same height as last time is the ordinary case. The observer fires for
    // every size change, and most of them do not move this.
    setThumb((prev) => (prev?.height === height ? prev : { height }));
    position();
  }, [position]);

  // Re-measured when the box changes size *and* when what is in it does. The
  // queue loses a day to a booking, or gains one when lines are moved onto a
  // report that did not exist a moment ago.
  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (scrollRef.current) observer.observe(scrollRef.current);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [measure]);

  // The first paint after the thumb appears: `measure` positioned it while
  // there was no node to position, so it starts at translateY(0), which is
  // wrong for a box restored mid-scroll.
  useEffect(() => {
    if (thumb) position();
  }, [thumb, position]);

  /**
   * Dragging the thumb, in the thumb's own units: a pixel of thumb is
   * `(scrollable height / thumb travel)` pixels of content.
   *
   * Pointer capture rather than window listeners, so the drag survives the
   * pointer leaving the panel, which it will, because the panel is 16rem wide
   * and a drag down its edge is a flick of the wrist.
   */
  function onThumbDown(e: React.PointerEvent<HTMLDivElement>) {
    const el = scrollRef.current;
    if (!el || !thumb) return;
    e.preventDefault();
    // Held in a local: React clears `currentTarget` once the handler returns,
    // and everything below runs after that. A listener that removed itself
    // from `e.currentTarget` would be removing itself from null.
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    setDragging(true);

    const startY = e.clientY;
    const startTop = el.scrollTop;
    const { travel, scrollable } = track.current;

    const move = (ev: PointerEvent) => {
      // A thumb with nowhere to travel (a box barely longer than its view)
      // would divide by zero and jump to the bottom on the first pixel.
      if (travel <= 0) return;
      el.scrollTop = startTop + ((ev.clientY - startY) / travel) * scrollable;
    };
    const up = () => {
      setDragging(false);
      if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId);
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
    };
    // On the thumb rather than on the window: the capture above retargets every
    // move to it, so this is where they arrive however far the pointer strays.
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  }

  return (
    // `group` so the thumb can firm up when the pointer is anywhere in the
    // panel, which is the moment someone is about to reach for it.
    <div className={cn("group relative", frameClassName)}>
      {/* `position`, not `measure`: scrolling moves the thumb, it does not
          change how long it is. What does change its length, the box or its
          contents resizing, the observer above is already watching for. */}
      <div ref={scrollRef} onScroll={position} className={cn("no-native-scrollbar", className)}>
        <div ref={contentRef}>{children}</div>
      </div>

      {thumb && (
        <div
          ref={thumbRef}
          // Not in the accessibility tree and not a tab stop: the box scrolls
          // with the keyboard on its own, and a screen reader has the rows.
          aria-hidden
          onPointerDown={onThumbDown}
          // `top: 0` and a transform for the rest: the offset is written by
          // `position` on every scroll frame, and a transform is the one way to
          // move something that costs no layout.
          style={{ top: 0, height: thumb.height }}
          className={cn(
            "absolute right-1 w-1.5 cursor-default rounded-full will-change-transform",
            // Translucent over whatever it crosses, and blurring it rather than
            // merely tinting it. The thumb reads as a piece of glass laid on
            // the list instead of a bar drawn into it.
            "bg-foreground/20 backdrop-blur-sm transition-colors",
            dragging ? "bg-foreground/40" : "group-hover:bg-foreground/35",
          )}
        />
      )}
    </div>
  );
}
