"use client";

// Implementation of the zoomable receipt viewer. Loaded client-only (via the
// dynamic wrapper in receipt-viewer.tsx) because pdf.js touches browser globals
// such as DOMMatrix at import time and can't be evaluated during SSR.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Document, Page, pdfjs } from "react-pdf";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/spinner";
import { useFocusTrap } from "@/lib/ui/focus-trap";
import { useMediaQuery } from "@/lib/ui/media";
import { cn } from "@/lib/ui/utils";

// pdf.js parses in a Web Worker, so it needs a URL to load that worker from.
// Resolving it through the bundler (rather than copying the file into /public)
// means the worker is always the one from the installed pdfjs-dist, with no copy
// step to run, and no way for it to drift from the version react-pdf expects.
//
// That is also why package.json depends on pdfjs-dist at the exact version
// react-pdf pins: this import reaches past react-pdf into its own dependency,
// which a flat node_modules happens to allow and pnpm's does not. Declaring it
// is what makes the import legitimate, and keeping it exact is what keeps the
// worker and the library the same build.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

// Two-finger trackpad scrolling should pan the receipt; a mouse wheel should
// zoom. The platform gives us nothing to tell them apart, since both arrive as
// a `wheel` event with ctrlKey false (only a pinch sets ctrlKey), so we have to
// judge by the shape of the deltas.
const GESTURE_GAP_MS = 200;
const WHEEL_MIN_DELTA = 40;

// How long the container has to hold still before the PDF is re-rendered at the
// new width. Long enough that a drag produces one render at the end rather than
// sixty on the way, short enough that letting go feels like it took.
const RESIZE_SETTLE_MS = 180;

// The same, for the zoom. See `pixelRatio` below. Longer, because a wheel zoom
// is a continuous gesture and re-rasterising an A4 page mid-scroll is the one
// thing that would make zooming feel worse than the blur it is fixing.
const ZOOM_SETTLE_MS = 300;

/**
 * The widest canvas a page may be rasterised into, in device pixels.
 *
 * A ceiling on memory, not on quality: the canvas is width × height × 4 bytes,
 * so an A4 page at this width is about 14M pixels and 58MB. Mobile Safari
 * refuses a canvas over 16.7M pixels outright, which is the number this has to
 * stay under.
 *
 * Generous enough to be worth having: uploads are capped at 2400px on the long
 * side (lib/server/images.ts), so a photographed receipt is shown at every
 * pixel it has well before this bites, and a vector PDF gets ~340 DPI on A4.
 * Past it you are zooming into a bitmap and it blurs, which is what every PDF
 * viewer does eventually.
 */
const MAX_CANVAS_WIDTH = 3200;

function looksLikeTrackpad(e: WheelEvent): boolean {
  // Firefox reports line/page steps, and only ever does so for a real wheel.
  if (e.deltaMode !== 0) return false;
  // Chromium and WebKit still expose the legacy wheelDelta, where a physical
  // wheel always reports whole 120-unit notches. Strongest signal we get.
  const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
  if (typeof legacy === "number" && legacy !== 0)
    return Math.abs(legacy) % 120 !== 0;
  // Otherwise: a wheel notch is coarse, whole and purely vertical.
  if (e.deltaX !== 0) return true;
  return !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < WHEEL_MIN_DELTA;
}

/** One thing to look at. A PDF is shown whole (every page, stacked) and an
 *  image is shown as it was stored. */
export interface ViewerDocument {
  /** Where the file is: an archive URL, or a local one for a file not yet
   *  uploaded. The viewer only ever reads it. */
  src: string;
  mimeType: string;
  /** Alt text, for a document that is an image. */
  filename?: string;
  /**
   * Open the panel on this one rather than on the first.
   *
   * Reading order and landing page are two different questions, and an utlägg
   * is the case where they part: the utläggsräkning is the front of the
   * document and belongs first, but the receipt behind it is what somebody came
   * to look at. Whoever builds the list decides both, in one place, rather than
   * the panel taking an index that could drift out of step with it.
   *
   * The first one marked wins; none marked opens on the first, which is what
   * every other caller means by saying nothing.
   */
  defaultOpen?: boolean;
}

export interface ReceiptViewerProps {
  /**
   * What there is to read, in reading order: the utläggsräkning and the
   * underlag behind it, say. One at a time on screen, with the pager in the
   * toolbar moving between them.
   *
   * A list rather than one merged PDF because merging is printing: it lays a
   * photographed receipt onto a white A4 sheet, which is right for the file
   * Fortnox is sent and wrong for a panel someone is reading in.
   */
  documents: ViewerDocument[];
  /** Sizing/framing for the inline (non-fullscreen) viewer. */
  className?: string;
}

export default function ReceiptViewerImpl({
  documents,
  className,
}: ReceiptViewerProps) {
  const t = useTranslations("receipt");

  // A finger rather than a pointer. Not the `md` breakpoint the rest of the app
  // branches on: what changes here is what the hardware can raster and whether
  // there is a cursor to dress, neither of which is a question about width.
  const coarse = useMediaQuery("(pointer: coarse)");

  const [fullscreen, setFullscreen] = useState(false);
  // Which document is open. Clamped rather than trusted: a receipt replaced
  // while the panel is on it shortens the list under the reader.
  const opensAt = () => Math.max(0, documents.findIndex((d) => d.defaultOpen));
  const [index, setIndex] = useState(opensAt);
  const at = Math.min(index, Math.max(0, documents.length - 1));
  const doc = documents[at];
  const src = doc?.src ?? "";
  const filename = doc?.filename;
  const isPdf = doc?.mimeType === "application/pdf";

  const [numPages, setNumPages] = useState(0);
  // The receipt failed to load, and which retry we're on. An outage of the
  // archive, not of anything else on the page. The counter rides in the URL so
  // a retry misses the browser's own cache of the failed response; without that
  // it re-fails without having asked anyone anything.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The cache-busting query only makes sense for a URL that was fetched. A
  // blob: URL is the browser's own copy. It cannot fail this way, and a query
  // string appended to one addresses nothing.
  const fetched = !src.startsWith("blob:");
  const fileSrc = attempt && fetched ? `${src}?retry=${attempt}` : src;
  const retry = () => {
    setFailed(false);
    setAttempt((n) => n + 1);
  };

  // A different document is a different everything: its own page count, and
  // none of the previous one's failure. Keyed on the address rather than the
  // index, so a receipt replaced in place resets too, and not on `fileSrc`,
  // which is what a retry changes and must not clear the attempt it just made.
  //
  // During the render rather than in an effect, so the document is never once
  // painted with the last one's page count: the reset is part of showing this
  // document, not something that happens to it afterwards.
  // A different *set* of documents opens where its author says, rather than
  // wherever the last set was left. The panel lives in the app shell and is
  // never remounted, so without this the second utlägg you open inherits the
  // page you had paged to on the first. Keyed on the addresses rather than on
  // the array, which a page building the list inline rebuilds every render.
  const docsKey = documents.map((d) => d.src).join("\u0000");
  const [openedFor, setOpenedFor] = useState(docsKey);
  if (openedFor !== docsKey) {
    setOpenedFor(docsKey);
    setIndex(opensAt());
  }

  const [shown, setShown] = useState(src);
  if (shown !== src) {
    setShown(src);
    setNumPages(0);
    setFailed(false);
    setAttempt(0);
  }

  const containerRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // What the page is currently magnified by. Settled, not live. See the
  // handler on TransformWrapper.
  const [zoom, setZoom] = useState(1);
  const zoomSettle = useRef<ReturnType<typeof setTimeout>>(undefined);
  // What `zoom` currently is, readable from inside the transform handler, which
  // runs on every frame of every gesture and must not be re-created for each new
  // value of it.
  const settledZoom = useRef(1);
  // Closing the panel mid-gesture leaves a timer holding a setter for a
  // component that is gone.
  useEffect(() => () => clearTimeout(zoomSettle.current), []);
  // Which device the wheel events are coming from. Drives `wheel.wheelDisabled`
  // below, which is what routes an event to the library's zoom or its pan.
  const [trackpadMode, setTrackpadMode] = useState(false);
  const gesture = useRef({ at: 0, trackpad: false });
  // Whether the pointer is over the receipt, for the F shortcut below. A ref
  // rather than state: nothing renders differently for it.
  const hovered = useRef(false);

  // Whether a drag is in progress, for the cursor alone.
  //
  // This used to be `active:cursor-grabbing` on the library's own wrapper, and
  // it came off in the reader's hand: `:active` is set on the element the
  // button went down on, and react-pdf replaces that element. Switching
  // documents resets the page count, which re-rasterises the stack (new
  // canvases, the old ones removed) and a page rasterising under a held
  // pointer takes the mousedown target with it. The browser drops `:active`
  // with the node, the wrapper stops matching, and the hand becomes an arrow
  // mid-drag with the pan still running underneath it.
  //
  // State on our own container instead, which nothing in this component ever
  // unmounts. Not the library's onPanningStart/Stop, which fire for a trackpad
  // scroll too and would flicker the cursor on every wheel gesture.
  const [dragging, setDragging] = useState(false);
  // Only for a pointer that has a cursor to change. On a touchscreen this state
  // dressed nothing and cost a full re-render of the viewer, the Document and
  // every Page in it, at the exact moment a finger landed to start a drag,
  // which is the moment a drag can least afford one.
  const startDrag = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") setDragging(true);
  };
  useEffect(() => {
    if (!dragging) return;
    const stop = () => setDragging(false);
    // On the window, and for `pointercancel` as well: a drag that ends off the
    // panel, or that the browser takes over, must not leave a closed hand
    // over a receipt nobody is holding.
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragging]);

  // Set on the container rather than on the page, so it survives the subtree
  // being replaced, and inherited by everything inside it. The toolbar's
  // buttons state their own `pointer` in globals.css and are unaffected.
  const cursor = dragging ? "cursor-grabbing" : "cursor-grab";

  // Track the container width so PDF pages render to fit (then zoom from there).
  // ResizeObserver fires once on observe, so it supplies the initial width too.
  //
  // Settled width, not live width: a PDF page is re-rasterised at every value
  // this takes, so dragging the panel's edge, or resizing the window, meant a
  // full pdf.js render per frame, and the drag crawled. The first measurement
  // still lands immediately (nothing is on screen yet to keep steady); after
  // that the width only moves once the dragging has stopped.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let measured = false;
    const ro = new ResizeObserver(() => {
      if (!measured) {
        measured = true;
        setWidth(el.clientWidth);
        return;
      }
      clearTimeout(timer);
      // Read inside the timer, not now: what matters is where it ended up.
      timer = setTimeout(() => setWidth(el.clientWidth), RESIZE_SETTLE_MS);
    });
    ro.observe(el);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, [fullscreen]);

  // Tell the pan/zoom library that the document got taller.
  //
  // It works out how far you may pan once, at mount and again whenever
  // TransformWrapper re-renders (its `update` recalculates the bounds from the
  // content element's offsetHeight), and it caches the answer. Nothing else
  // recomputes it: a wheel-pan reads the cached bounds and clamps to them.
  //
  // At mount there is no document yet, so the cached answer is "the content
  // fits, there is nowhere to pan". A PDF then rasterises page by page inside
  // react-pdf, which re-renders itself and not us, so the answer was never
  // revisited and two fingers on a trackpad moved nothing at all. It went
  // unnoticed while a page was shown one at a time, because zooming *does*
  // recalculate the bounds and a single page is only worth panning zoomed in.
  //
  // So: watch the stack, and when its height changes put one render through
  // this component. That re-renders TransformWrapper, which is all it takes.
  // The height itself is never read. Holding it in state is the message.
  const [, setStackHeight] = useState(0);
  useEffect(() => {
    const el = stackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStackHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fullscreen, src]);

  // Classify each wheel gesture before react-zoom-pan-pinch sees it (capture
  // phase, its own listeners sit on the wrapper below and bubble).
  //
  // A fast two-finger flick can reach wheel-sized deltas, so the verdict is
  // latched for the whole gesture: events less than GESTURE_GAP_MS apart keep
  // the first verdict, and any trackpad-looking event pins the run to trackpad.
  // A wheel never produces the small fractional deltas a flick ramps up
  // through, so the latch can only ever be wrong in the harmless direction.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // a pinch: unambiguous, and always zooms

      const g = gesture.current;
      const continuing = e.timeStamp - g.at < GESTURE_GAP_MS;
      const trackpad = continuing
        ? g.trackpad || looksLikeTrackpad(e)
        : looksLikeTrackpad(e);
      g.at = e.timeStamp;
      g.trackpad = trackpad;

      if (trackpad === trackpadMode) return; // already routed correctly
      // Swallow the single event it takes React to re-render with the new
      // mode, so a gesture never opens by doing the opposite of what was meant.
      e.preventDefault();
      e.stopPropagation();
      setTrackpadMode(trackpad);
    };
    el.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => el.removeEventListener("wheel", onWheel, true);
  }, [trackpadMode, fullscreen]);

  // Tab is held inside the overlay while it is up. Fullscreen covers the page
  // it was opened from, and tabbing out of the last control landed on buttons
  // nobody could see. See lib/ui/focus-trap.ts.
  useFocusTrap(fullscreen, containerRef);

  // Esc exits fullscreen.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setFullscreen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // F toggles fullscreen. Scoped to the pointer being over the receipt (or to
  // already being fullscreen), so the key stays free everywhere else on a page
  // that also holds a form, and never fires while something is being typed
  // into, where "f" is just an f.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "f" && e.key !== "F") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.isContentEditable) return;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (!fullscreen && !hovered.current) return;
      e.preventDefault();
      setFullscreen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // Lock background scroll while in fullscreen.
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  const pdfWidth = width ? Math.min(width - 24, 1100) : 600;

  // How many device pixels each CSS pixel of the page is drawn with.
  //
  // The zoom is a CSS transform, so without this the page is rasterised once at
  // its unzoomed size and then stretched: magnifying a receipt to read the VAT
  // line showed a bigger blur rather than more detail. Following the zoom means
  // the canvas is re-drawn at the size it is actually being looked at.
  //
  // The floor of 2 is for the non-retina monitors a lot of this is read on. A
  // page rasterised 1:1 is legible and no better than legible, and a receipt is
  // a thing people lean in at, and doubling it costs one re-render of a document
  // that is already on screen.
  //
  // react-pdf defaults this to window.devicePixelRatio and multiplies the
  // viewport by it (its Page/Canvas), so this is the same knob, turned by us.
  const pixelRatio = useMemo(() => {
    if (!isPdf || !pdfWidth) return undefined;
    const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    // The 2 is a floor on a desktop and a ceiling on a phone, and it is the same
    // 2 for the same reason: two device pixels per CSS pixel is where a receipt
    // stops getting more legible.
    //
    // A monitor reporting 1 is below that and gets raised to it. A phone reports
    // 2 or 3 and is already at or past it, and there the extra density is not
    // free, because a phone is compositing the same A4 sheet with a fraction of
    // the memory bandwidth. At 3 a page is a canvas half again as wide and more
    // than twice the pixels, for detail on a 6-inch screen nobody can resolve.
    const base = coarse ? Math.min(dpr, 2) : Math.max(2, dpr);
    // The ceiling is per page and a document is now all of its pages at once,
    // so the budget is shared out. Square root because the cap is a width and
    // what it is really rationing is area: n pages each capped at
    // MAX/√n come to the same total pixels as one page capped at MAX,
    // whatever n is. Floored at the display's own resolution, so sharing only
    // ever costs magnification, never the sharpness of a page sitting still.
    const share = Math.max(
      base,
      MAX_CANVAS_WIDTH / pdfWidth / Math.sqrt(Math.max(1, numPages)),
    );
    return Math.max(1, Math.min(base * zoom, share));
  }, [isPdf, pdfWidth, zoom, numPages, coarse]);

  // Nothing to show. The panel decides what an empty list means, a dropzone or
  // a notice that there is no underlag, and only reaches for the viewer when
  // there is something in it; this is here so the hooks above can be
  // unconditional.
  if (!doc) return null;

  const content = (
    // wheelDisabled only suppresses zoom for ctrlKey-less events, and the
    // library routes exactly those to trackPadPanning instead, so this single
    // flag swaps scroll-to-pan and scroll-to-zoom. A pinch zooms either way.
    <TransformWrapper
      minScale={0.5}
      maxScale={10}
      doubleClick={{ mode: "zoomIn" }}
      wheel={{ step: 0.005, wheelDisabled: trackpadMode }}
      trackPadPanning={{ disabled: false }}
      // The pan, on the compositor instead of the main thread.
      //
      // The library writes a plain 2D `translate(x,y) scale(s)` to the content
      // element on every frame, deliberately, its comment says, because a 3D
      // transform blurs SVG on Safari. A 2D transform is not a reason for the
      // browser to give the element a layer of its own, so each frame repainted
      // everything inside it: on a phone, a stack of A4 canvases at 3× density,
      // sixty times a second. Dragging a receipt crawled.
      //
      // `translate3d` promotes it, and from then on a pan is the compositor
      // moving one texture. The blur the library is guarding against is about
      // vector content magnified by the transform, and there is none here: pages
      // are canvases, and the zoom re-rasterises them at the new scale anyway
      // (see `pixelRatio`), which is a sharper answer than the 2D transform's.
      customTransform={(x, y, scale) =>
        `translate3d(${x}px, ${y}px, 0) scale(${scale})`
      }
      // Fires on every frame of a pan as well as a zoom, so it is settled
      // before it reaches state: re-rasterising an A4 page sixty times a second
      // would cost far more than the sharpness it buys.
      //
      // A pan does not change `scale`, and those frames are the overwhelming
      // majority, so they leave without touching the timer at all. Rescheduling
      // it per frame was work for nothing (React dropped the equal value at the
      // end of it), done in the middle of the gesture it was slowing down.
      onTransform={(_ref, state) => {
        const scale = state.scale;
        // Back at the scale we last rendered: nothing to re-rasterise, and any
        // settle still pending is now aimed at the wrong number.
        if (scale === settledZoom.current) {
          clearTimeout(zoomSettle.current);
          return;
        }
        clearTimeout(zoomSettle.current);
        zoomSettle.current = setTimeout(() => {
          settledZoom.current = scale;
          setZoom(scale);
        }, ZOOM_SETTLE_MS);
      }}
    >
        {({ zoomIn, zoomOut, resetTransform }) => (
          <>
            <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full border border-border bg-background/90 p-1 shadow-sm backdrop-blur">
              {/* The pager steps between documents, not between pages. The
                  pages of one document are all there to scroll through. So on
                  an utlägg this is "cover ⇄ underlag", which is the only jump
                  left worth a button. The transform resets with it: arriving
                  at a new document zoomed into where the last one's corner was
                  is nobody's idea of turning a page. */}
              {documents.length > 1 && (
                <>
                  <ToolBtn
                    label={t("prevDocument")}
                    disabled={at <= 0}
                    onClick={() => {
                      setIndex(Math.max(0, at - 1));
                      resetTransform();
                    }}
                  >
                    ‹
                  </ToolBtn>
                  <span className="px-1 text-xs tabular-nums text-muted">
                    {at + 1}/{documents.length}
                  </span>
                  <ToolBtn
                    label={t("nextDocument")}
                    disabled={at >= documents.length - 1}
                    onClick={() => {
                      setIndex(Math.min(documents.length - 1, at + 1));
                      resetTransform();
                    }}
                  >
                    ›
                  </ToolBtn>
                  <span className="mx-0.5 h-5 w-px bg-border" />
                </>
              )}
              <ToolBtn label={t("zoomOut")} onClick={() => zoomOut()}>
                −
              </ToolBtn>
              <ToolBtn label={t("zoomIn")} onClick={() => zoomIn()}>
                +
              </ToolBtn>
              <ToolBtn label={t("reset")} onClick={() => resetTransform()}>
                <ResetIcon />
              </ToolBtn>
              <span className="mx-0.5 h-5 w-px bg-border" />
              {/* The one control worth naming out loud. Fullscreen is how a
                  receipt is actually read, and as an unlabelled 28px icon in a
                  corner nobody found it, so inline it carries its word, and
                  both states name the key in the tooltip. */}
              <ToolBtn
                label={fullscreen ? t("exitFullscreen") : t("fullscreen")}
                title={fullscreen ? t("exitFullscreenKey") : t("fullscreenKey")}
                onClick={() => setFullscreen((v) => !v)}
                wide={!fullscreen}
              >
                {fullscreen ? (
                  <CloseIcon />
                ) : (
                  <>
                    <ExpandIcon />
                    <span className="hidden text-xs font-medium sm:inline">
                      {t("fullscreen")}
                    </span>
                  </>
                )}
              </ToolBtn>
            </div>

            <TransformComponent
              wrapperStyle={{ width: "100%", height: "100%" }}
              // Centring lives on the transformed element itself, and as a
              // *minimum* height rather than a fixed one.
              //
              // The library derives how far you may pan from this element's
              // offsetHeight. Fixed at 100% it was exactly the panel, so a
              // receipt taller than the panel hung out of it, half above the
              // top, and panning stopped at a box that didn't contain what you
              // were looking at, leaving the top of a zoomed page unreachable.
              // Growing past 100% instead, the element is always as tall as the
              // receipt in it, and centring only does anything when there's
              // slack to centre in. (The element is already display:flex, from
              // the library's own stylesheet.)
              contentStyle={{
                width: "100%",
                minHeight: "100%",
                alignItems: "center",
                justifyContent: "center",
                padding: "0.5rem",
                // Says in advance what `customTransform` above then does, so the
                // layer is standing before the first frame of a gesture rather
                // than being built during it.
                willChange: "transform",
              }}
            >
              {/* One measured box around whatever is being shown: a stack of
                  pages, an image, a failure. It is what the observer above
                  watches, and the library's own content element is its parent,
                  so the two grow together. */}
              <div ref={stackRef} className="flex w-full flex-col items-center">
                {isPdf ? (
                  <Document
                    key={src}
                    file={fileSrc}
                    onLoadSuccess={({ numPages: n }) => setNumPages(n)}
                    loading={<PdfLoading />}
                    error={<LoadFailed onRetry={retry} pdfHref={src} />}
                    // Every page at once, stacked, rather than one with buttons
                    // either side. A receipt that runs to three pages is one
                    // document and reads as one, so you scroll it. The stack is a
                    // single child so the library's own flex row still centres
                    // it, and the content element grows to fit (see contentStyle
                    // above), which is what makes the pan reach the bottom of it.
                    className="flex flex-col items-center gap-2"
                  >
                    {Array.from({ length: numPages }, (_, i) => (
                      <Page
                        key={i}
                        pageNumber={i + 1}
                        width={pdfWidth}
                        devicePixelRatio={pixelRatio}
                        renderTextLayer={false}
                        renderAnnotationLayer={false}
                        // Each page reads as a sheet, which is what tells a
                        // stack of them apart from one long page.
                        className="overflow-hidden rounded-sm shadow-[var(--shadow-card)]"
                        // Nothing per page while it rasterises: the default is
                        // the words "Loading page", and a column of those is
                        // worse than a stack that simply fills in.
                        loading=""
                      />
                    ))}
                  </Document>
                ) : failed ? (
                  <LoadFailed onRetry={retry} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={fileSrc}
                    alt={filename ?? t("alt")}
                    draggable={false}
                    onError={() => setFailed(true)}
                    className="max-w-full select-none"
                  />
                )}
              </div>
            </TransformComponent>
          </>
        )}
    </TransformWrapper>
  );

  // Fullscreen renders through a portal to <body> so no ancestor's overflow,
  // transform or stacking context can trap or clip the overlay.
  if (fullscreen) {
    return createPortal(
      <div
        ref={containerRef}
        onPointerDown={startDrag}
        className={cn(
          "fixed inset-0 z-100 touch-none overflow-hidden bg-black/90",
          cursor,
        )}
      >
        {content}
      </div>,
      document.body,
    );
  }

  return (
    <div
      ref={containerRef}
      onPointerEnter={() => (hovered.current = true)}
      onPointerLeave={() => (hovered.current = false)}
      onPointerDown={startDrag}
      // touch-none says the gestures in here are the viewer's, all of them.
      // Without it the browser opens every touch by holding the first moves back
      // to see whether they were meant for a scroll it might have to run itself,
      // which is the drag starting late, every time. There is nothing to
      // scroll (this element is overflow-hidden), so it was only ever a wait.
      className={cn(
        "relative touch-none overflow-hidden bg-surface/40",
        cursor,
        className,
      )}
    >
      {content}
    </div>
  );
}

function ToolBtn({
  children,
  label,
  title,
  onClick,
  disabled,
  wide,
}: {
  children: React.ReactNode;
  label: string;
  /** Tooltip, when it should say more than the accessible name, such as the keyboard
   *  shortcut. Defaults to `label`. */
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  /** Carries a text label beside its icon, so it isn't a square. */
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      className={cn(
        "flex items-center justify-center rounded-full text-[15px] leading-none text-foreground transition-colors hover:bg-surface disabled:opacity-30",
        wide ? "h-7 gap-1.5 px-2" : "size-7",
      )}
    >
      {children}
    </button>
  );
}

// Rendering a page can take a moment on a big scan, and the panel is otherwise
// blank while it does.
function PdfLoading() {
  const t = useTranslations("receipt");
  return (
    <div
      role="status"
      className="flex items-center gap-2.5 p-6 text-sm text-muted"
    >
      <Spinner size="md" />
      {t("loadingPdf")}
    </div>
  );
}

// Storage is the one dependency that can be down while everything else works,
// so this says which part is broken (the archive, not the utlägg) rather than
// leaving a broken-image glyph to imply the receipt was never there.
function LoadFailed({
  onRetry,
  pdfHref,
}: {
  onRetry: () => void;
  pdfHref?: string;
}) {
  const t = useTranslations("receipt");
  return (
    <div className="flex max-w-xs flex-col items-center gap-2 p-6 text-center">
      <p className="text-sm font-medium text-foreground">{t("loadFailed")}</p>
      <p className="text-xs text-muted">{t("loadFailedHint")}</p>
      <div className="mt-1 flex items-center gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-surface"
        >
          {t("retry")}
        </button>
        {pdfHref && (
          <a
            href={pdfHref}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent"
          >
            {t("pdfFailed")}
          </a>
        )}
      </div>
    </div>
  );
}

const ResetIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="size-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

const ExpandIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="size-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3" />
  </svg>
);

const CloseIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="size-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
