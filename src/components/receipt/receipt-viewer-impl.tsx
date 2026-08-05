"use client";

// Implementation of the zoomable receipt viewer. Loaded client-only (via the
// dynamic wrapper in receipt-viewer.tsx) because pdf.js touches browser globals
// such as DOMMatrix at import time and can't be evaluated during SSR.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Document, Page, pdfjs } from "react-pdf";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/ui/utils";

// pdf.js parses in a Web Worker, so it needs a URL to load that worker from.
// Resolving it through the bundler (rather than copying the file into /public)
// means the worker is always the one from the installed pdfjs-dist — no copy
// step to run, and no way for it to drift from the version react-pdf expects.
//
// That is also why package.json depends on pdfjs-dist at the exact version
// react-pdf pins: this import reaches past react-pdf into its own dependency,
// which a flat node_modules happens to allow and pnpm's does not. Declaring it
// is what makes the import legitimate — and keeping it exact is what keeps the
// worker and the library the same build.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

// Two-finger trackpad scrolling should pan the receipt; a mouse wheel should
// zoom. The platform gives us nothing to tell them apart — both arrive as a
// `wheel` event with ctrlKey false (only a pinch sets ctrlKey) — so we have to
// judge by the shape of the deltas.
const GESTURE_GAP_MS = 200;
const WHEEL_MIN_DELTA = 40;

// How long the container has to hold still before the PDF is re-rendered at the
// new width. Long enough that a drag produces one render at the end rather than
// sixty on the way, short enough that letting go feels like it took.
const RESIZE_SETTLE_MS = 180;

function looksLikeTrackpad(e: WheelEvent): boolean {
  // Firefox reports line/page steps, and only ever does so for a real wheel.
  if (e.deltaMode !== 0) return false;
  // Chromium and WebKit still expose the legacy wheelDelta, where a physical
  // wheel always reports whole 120-unit notches. Strongest signal we get.
  const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
  if (typeof legacy === "number" && legacy !== 0) return Math.abs(legacy) % 120 !== 0;
  // Otherwise: a wheel notch is coarse, whole and purely vertical.
  if (e.deltaX !== 0) return true;
  return !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < WHEEL_MIN_DELTA;
}

export interface ReceiptViewerProps {
  /** Where the file is — an archive URL, or a local one for a file not yet
   *  uploaded. The viewer only ever reads it. */
  src: string;
  mimeType: string;
  filename?: string;
  /** Sizing/framing for the inline (non-fullscreen) viewer. */
  className?: string;
}

export default function ReceiptViewerImpl({
  src,
  mimeType,
  filename,
  className,
}: ReceiptViewerProps) {
  const t = useTranslations("receipt");
  const isPdf = mimeType === "application/pdf";

  const [fullscreen, setFullscreen] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  // The receipt failed to load, and which retry we're on — an outage of the
  // archive, not of anything else on the page. The counter rides in the URL so
  // a retry misses the browser's own cache of the failed response; without that
  // it re-fails without having asked anyone anything.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The cache-busting query only makes sense for a URL that was fetched. A
  // blob: URL is the browser's own copy — it cannot fail this way, and a query
  // string appended to one addresses nothing.
  const fetched = !src.startsWith("blob:");
  const fileSrc = attempt && fetched ? `${src}?retry=${attempt}` : src;
  const retry = () => {
    setFailed(false);
    setAttempt((n) => n + 1);
  };
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // Which device the wheel events are coming from. Drives `wheel.wheelDisabled`
  // below, which is what routes an event to the library's zoom or its pan.
  const [trackpadMode, setTrackpadMode] = useState(false);
  const gesture = useRef({ at: 0, trackpad: false });
  // Whether the pointer is over the receipt, for the F shortcut below. A ref
  // rather than state: nothing renders differently for it.
  const hovered = useRef(false);

  // Track the container width so PDF pages render to fit (then zoom from there).
  // ResizeObserver fires once on observe, so it supplies the initial width too.
  //
  // Settled width, not live width: a PDF page is re-rasterised at every value
  // this takes, so dragging the panel's edge — or resizing the window — meant a
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
      const trackpad = continuing ? g.trackpad || looksLikeTrackpad(e) : looksLikeTrackpad(e);
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

  // Esc exits fullscreen.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFullscreen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // F toggles fullscreen. Scoped to the pointer being over the receipt (or to
  // already being fullscreen), so the key stays free everywhere else on a page
  // that also holds a form — and never fires while something is being typed
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

  const content = (
    // wheelDisabled only suppresses zoom for ctrlKey-less events, and the
    // library routes exactly those to trackPadPanning instead — so this single
    // flag swaps scroll-to-pan and scroll-to-zoom. A pinch zooms either way.
    <TransformWrapper
      minScale={0.5}
      maxScale={10}
      doubleClick={{ mode: "zoomIn" }}
      wheel={{ step: 0.005, wheelDisabled: trackpadMode }}
      trackPadPanning={{ disabled: false }}
    >
        {({ zoomIn, zoomOut, resetTransform }) => (
          <>
            <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full border border-border bg-background/90 p-1 shadow-sm backdrop-blur">
              {isPdf && numPages > 1 && (
                <>
                  <ToolBtn label={t("prevPage")} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    ‹
                  </ToolBtn>
                  <span className="px-1 text-xs tabular-nums text-muted">
                    {page}/{numPages}
                  </span>
                  <ToolBtn label={t("nextPage")} disabled={page >= numPages} onClick={() => setPage((p) => Math.min(numPages, p + 1))}>
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
                  corner nobody found it — so inline it carries its word, and
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
              // receipt taller than the panel hung out of it — half above the
              // top — and panning stopped at a box that didn't contain what you
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
              }}
              wrapperClass="!cursor-grab active:!cursor-grabbing"
            >
              {isPdf ? (
                <Document
                  file={fileSrc}
                  onLoadSuccess={({ numPages: n }) => {
                    setNumPages(n);
                    setPage(1);
                  }}
                  loading={<PdfLoading />}
                  error={<LoadFailed onRetry={retry} pdfHref={src} />}
                >
                  <Page
                    pageNumber={page}
                    width={pdfWidth}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                  />
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
            </TransformComponent>
          </>
        )}
    </TransformWrapper>
  );

  // Fullscreen renders through a portal to <body> so no ancestor's overflow,
  // transform or stacking context can trap or clip the overlay.
  if (fullscreen) {
    return createPortal(
      <div ref={containerRef} className="fixed inset-0 z-100 overflow-hidden bg-black/90">
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
      className={cn("relative overflow-hidden bg-surface/40", className)}
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
  /** Tooltip, when it should say more than the accessible name — the keyboard
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
    <div role="status" className="flex items-center gap-2.5 p-6 text-sm text-muted">
      <Spinner size="md" />
      {t("loadingPdf")}
    </div>
  );
}

// Storage is the one dependency that can be down while everything else works,
// so this says which part is broken — the archive, not the utlägg — rather than
// leaving a broken-image glyph to imply the receipt was never there.
function LoadFailed({ onRetry, pdfHref }: { onRetry: () => void; pdfHref?: string }) {
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
          <a href={pdfHref} target="_blank" rel="noreferrer" className="text-xs text-accent">
            {t("pdfFailed")}
          </a>
        )}
      </div>
    </div>
  );
}

const ResetIcon = () => (
  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

const ExpandIcon = () => (
  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
