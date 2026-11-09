"use client";

// A scrolling box whose scrollbar floats over the content instead of taking a column from it (native bars eat 11-15px on Windows and Linux). Draggable, hidden when nothing scrolls.
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/ui/utils";

const INSET = 4;
const MIN_THUMB = 28;

export function OverlayScroll({
  className,
  frameClassName,
  children,
}: {
  className?: string;
  /** The frame carrying the thumb, for a box that takes its height from a flex column. */
  frameClassName?: string;
  children: React.ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  // Only the height is state; where the thumb sits changes every scroll frame and is written straight to the node (see `position`).
  const [thumb, setThumb] = useState<{ height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const track = useRef({ travel: 0, scrollable: 0 });

  /** Moves the thumb to the scroll position. Straight to the node with a transform, not state: it runs every scroll frame. */
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
    // +1 absorbs sub-pixel layout, which would draw a full-height thumb on a box that does not scroll.
    if (scrollHeight <= clientHeight + 1) {
      setThumb(null);
      return;
    }
    const length = clientHeight - INSET * 2;
    const height = Math.max(MIN_THUMB, (clientHeight / scrollHeight) * length);
    track.current = { travel: length - height, scrollable: scrollHeight - clientHeight };
    setThumb((prev) => (prev?.height === height ? prev : { height }));
    position();
  }, [position]);

  // Re-measured when the box changes size and when its contents do.
  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (scrollRef.current) observer.observe(scrollRef.current);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [measure]);

  // The first paint after the thumb appears: measure had no node to position.
  useEffect(() => {
    if (thumb) position();
  }, [thumb, position]);

  /** Dragging the thumb: a pixel of thumb is (scrollable height / thumb travel) pixels of content. Pointer capture, so the drag survives leaving the panel. */
  function onThumbDown(e: React.PointerEvent<HTMLDivElement>) {
    const el = scrollRef.current;
    if (!el || !thumb) return;
    e.preventDefault();
    // Held in a local: React clears currentTarget once the handler returns.
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    setDragging(true);

    const startY = e.clientY;
    const startTop = el.scrollTop;
    const { travel, scrollable } = track.current;

    const move = (ev: PointerEvent) => {
      // A thumb with nowhere to travel would divide by zero.
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
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  }

  return (
    <div className={cn("group relative", frameClassName)}>
      <div ref={scrollRef} onScroll={position} className={cn("no-native-scrollbar", className)}>
        <div ref={contentRef}>{children}</div>
      </div>

      {thumb && (
        <div
          ref={thumbRef}
          // Not in the accessibility tree or tab order: the box scrolls by keyboard on its own.
          aria-hidden
          onPointerDown={onThumbDown}
          // top: 0 plus a transform: the offset is written every scroll frame without layout cost.
          style={{ top: 0, height: thumb.height }}
          className={cn(
            "absolute right-1 w-1.5 cursor-default rounded-full will-change-transform",
            "bg-foreground/20 backdrop-blur-sm transition-colors",
            dragging ? "bg-foreground/40" : "group-hover:bg-foreground/35",
          )}
        />
      )}
    </div>
  );
}
