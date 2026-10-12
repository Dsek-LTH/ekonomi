// Scrolling the view while something is being dragged towards its edge.
//
// A pointer drag (see components/ui/drag.tsx for the two kinds) only hears
// `pointermove`. Carry a row to the bottom of the screen and hold it there and
// nothing happens at all: the pointer has stopped, so there are no more events,
// and the place you are trying to reach is below the fold. The row can only go
// as far as the screen already showed.
//
// So the caller runs a frame loop while a drag is live and asks this what to do
// with the last pointer position it saw. The two halves are split because only
// one of them can be tested: `edgeVelocity` is arithmetic, `verticalScroller`
// is a walk up the DOM.

/**
 * How far to scroll this frame, in pixels, for a pointer `dist` px inside an
 * edge.
 *
 * Zero until the pointer is inside the band, then ramping to `max` at the very
 * edge, so a drag that merely ends up near the bottom does not creep and one
 * held against it moves at a useful speed. Linear: eased curves feel better on
 * a thing you are watching, and this is a thing you are steering, where a speed
 * you can predict beats one that looks nice.
 *
 * Negative `dist` (the pointer past the edge, which happens when it leaves the
 * window) is treated as being at the edge rather than as scrolling backwards.
 */
export function edgeVelocity(dist: number, band: number, max: number): number {
  if (dist >= band) return 0;
  const inside = Math.min(band, Math.max(0, band - dist));
  return (inside / band) * max;
}

/**
 * The nearest ancestor of `el` that actually scrolls vertically, or null when
 * nothing does and the page itself is what moves.
 *
 * "Actually": an element is only a scroller here if its overflow says it may
 * scroll *and* it has somewhere to scroll to. A `overflow-y-auto` box whose
 * content fits is not what the drag wants; it would swallow the scroll and the
 * page behind it would sit still.
 *
 * This is resolved per drag rather than once, because which element scrolls
 * depends on the breakpoint: below md the page scrolls, from md the main column
 * is the scrollport (see components/shell/app-shell).
 */
export function verticalScroller(el: Element | null): HTMLElement | null {
  for (let node = el as HTMLElement | null; node; node = node.parentElement) {
    if (node === document.body || node === document.documentElement) break;
    const overflow = getComputedStyle(node).overflowY;
    const scrollable = overflow === "auto" || overflow === "scroll" || overflow === "overlay";
    if (scrollable && node.scrollHeight > node.clientHeight + 1) return node;
  }
  return null;
}

/** How far a pointer at `y` is from the top and bottom of what it can scroll. */
function edgesOf(scroller: HTMLElement | null, y: number): { top: number; bottom: number } {
  if (!scroller) return { top: y, bottom: window.innerHeight - y };
  const r = scroller.getBoundingClientRect();
  return { top: y - r.top, bottom: r.bottom - y };
}

/** Pixels from an edge at which scrolling starts, and the speed per frame at it. */
const BAND = 72;
const MAX_PER_FRAME = 18;

/**
 * Scroll `scroller` (or the page) one frame's worth towards whichever edge the
 * pointer is near, and report whether anything moved.
 *
 * The caller wants that answer: the rows under the pointer have changed, so
 * whatever it worked out about where the drop would land has to be worked out
 * again, and there is no pointer event coming to prompt it.
 */
export function autoScrollStep(scroller: HTMLElement | null, pointerY: number): boolean {
  const { top, bottom } = edgesOf(scroller, pointerY);
  // Up wins a tie. Both bands only overlap on a viewport shorter than 144px,
  // where neither answer is better and picking one keeps this total.
  const dy = top < bottom
    ? -edgeVelocity(top, BAND, MAX_PER_FRAME)
    : edgeVelocity(bottom, BAND, MAX_PER_FRAME);
  if (dy === 0) return false;

  const before = scroller ? scroller.scrollTop : window.scrollY;
  if (scroller) scroller.scrollTop += dy;
  else window.scrollBy(0, dy);
  const after = scroller ? scroller.scrollTop : window.scrollY;
  // Not "we asked it to move": at the end of a list the ask does nothing, and a
  // caller told the view moved would redo its placement every frame for as long
  // as the pointer sat there.
  return after !== before;
}
