// Scrolls the view while a drag is held near its edge (a pointer drag only gets `pointermove`, so the caller
// runs a frame loop). `edgeVelocity` is arithmetic, `verticalScroller` walks the DOM.

/**
 * Pixels to scroll this frame for a pointer `dist` px inside an edge: 0 outside the band, ramping linearly to `max`.
 * Negative `dist` (pointer past the edge) counts as at the edge.
 */
export function edgeVelocity(dist: number, band: number, max: number): number {
  if (dist >= band) return 0;
  const inside = Math.min(band, Math.max(0, band - dist));
  return (inside / band) * max;
}

/**
 * The nearest ancestor of `el` that actually scrolls vertically (overflow allows it and content overflows), or null
 * for the page. Resolved per drag: below md the page scrolls, from md the main column does (components/shell/app-shell).
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

/** Scrolls `scroller` (or the page) one frame towards the near edge. Returns whether anything moved, so the caller can redo drop placement. */
export function autoScrollStep(scroller: HTMLElement | null, pointerY: number): boolean {
  const { top, bottom } = edgesOf(scroller, pointerY);
  // Up wins a tie (the bands only overlap on a viewport under 144px).
  const dy =
    top < bottom
      ? -edgeVelocity(top, BAND, MAX_PER_FRAME)
      : edgeVelocity(bottom, BAND, MAX_PER_FRAME);
  if (dy === 0) return false;

  const before = scroller ? scroller.scrollTop : window.scrollY;
  if (scroller) scroller.scrollTop += dy;
  else window.scrollBy(0, dy);
  const after = scroller ? scroller.scrollTop : window.scrollY;
  // Report whether the view moved, not whether we asked: at the end of a list the ask does nothing.
  return after !== before;
}
