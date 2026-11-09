"use client";

// Loaded client-only (via the dynamic wrapper in receipt-viewer.tsx) because pdf.js
// touches browser globals such as DOMMatrix at import time and can't be evaluated
// during SSR.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchContentRef,
} from "react-zoom-pan-pinch";
import { useTranslations } from "next-intl";
import { IconChevronDown, IconChevronLeft, IconChevronRight } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { useFocusTrap } from "@/lib/ui/focus-trap";
import { useMediaQuery } from "@/lib/ui/media";
import { cn } from "@/lib/ui/utils";
import { Button } from "@/components/ui/button";

// The worker is resolved through the bundler so it always matches the installed pdfjs-dist.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const TEXT_SELECTOR = ".textLayer span";
const TEXT_EXCLUDE = "textLayer span";

const RESIZE_SETTLE_MS = 180;

const ZOOM_SETTLE_MS = 300;

/** Mobile Safari refuses a canvas over 16.7M pixels outright, which is the number this has to stay under. */
const MAX_CANVAS_WIDTH = 3200;

const JUMP_MS = 300;

const JUMP_TOP = 52;

export interface ViewerDocument {
  src: string;
  mimeType: string;
  filename?: string;
  label?: string;
}

export interface ReceiptViewerProps {
  /** Merging lays a photographed receipt onto a white A4 sheet: right for the Fortnox file (lib/server/pdf-merge.ts), wrong for reading. */
  documents: ViewerDocument[];
  className?: string;
  navigation?: {
    jumpTo: { index: number; seq: number } | null;
    onCurrentChange: (i: number) => void;
  };
}

export default function ReceiptViewerImpl({
  documents,
  className,
  navigation,
}: ReceiptViewerProps) {
  const t = useTranslations("receipt");

  const coarse = useMediaQuery("(pointer: coarse)");

  const [fullscreen, setFullscreen] = useState(false);

  const anyPdf = documents.some((d) => d.mimeType === "application/pdf");
  const [pageCounts, setPageCounts] = useState<Record<string, number>>({});
  const reportPages = useCallback((src: string, n: number) => {
    setPageCounts((prev) => {
      if (n === 0) {
        if (!(src in prev)) return prev;
        const rest = { ...prev };
        delete rest[src];
        return rest;
      }
      return prev[src] === n ? prev : { ...prev, [src]: n };
    });
  }, []);

  const [turns, setTurns] = useState<Record<string, number>>({});
  const inView = useRef(0);

  const docsKey = documents.map((d) => d.src).join("\u0000");
  const [openedFor, setOpenedFor] = useState(docsKey);
  if (openedFor !== docsKey) {
    setOpenedFor(docsKey);
    setPageCounts({});
    setTurns({});
  }
  const totalPages = documents.reduce((n, d) => n + (pageCounts[d.src] ?? 0), 0);

  const containerRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const sheetRefs = useRef<(HTMLDivElement | null)[]>([]);
  const reportCurrent = useRef<(i: number) => void>(() => {});
  const registerBar = useCallback((set: ((i: number) => void) | null) => {
    reportCurrent.current = set ?? (() => {});
  }, []);
  const onCurrentChange = navigation?.onCurrentChange;
  useEffect(() => {
    if (onCurrentChange) registerBar(onCurrentChange);
  }, [onCurrentChange, registerBar]);
  const jumpQuiet = useRef(0);
  const rotateHold = useRef(false);
  const release = () => {
    rotateHold.current = false;
  };
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const zoomSettle = useRef<ReturnType<typeof setTimeout>>(undefined);
  const settledZoom = useRef(1);
  useEffect(() => () => clearTimeout(zoomSettle.current), []);
  const hovered = useRef(false);

  const [dragging, setDragging] = useState(false);
  const startDrag = (e: React.PointerEvent) => {
    release();
    if (e.pointerType === "touch") return;
    if (e.target instanceof Element && e.target.closest(TEXT_SELECTOR)) return;
    setDragging(true);
  };
  useEffect(() => {
    if (!dragging) return;
    const stop = () => setDragging(false);
    // On the window, and for `pointercancel` as well: a drag that ends off the panel,
    // or that the browser takes over, must not leave a closed hand over a receipt
    // nobody is holding.
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragging]);

  const cursor = dragging ? "cursor-grabbing" : "cursor-grab";

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", release, { capture: true, passive: true });
    return () => el.removeEventListener("wheel", release, { capture: true });
  }, [fullscreen]);

  // Settled width, not live width: a PDF page is re-rasterised at every value this
  // takes, so dragging the panel's edge, or resizing the window, meant a full pdf.js
  // render per frame, and the drag crawled.
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
      timer = setTimeout(() => setWidth(el.clientWidth), RESIZE_SETTLE_MS);
    });
    ro.observe(el);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, [fullscreen]);

  const [, setStackHeight] = useState(0);
  useEffect(() => {
    const el = stackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStackHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fullscreen, docsKey]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || documents.length < 2) return;
    const visible = new Map<number, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.sheet);
          visible.set(i, e.isIntersecting ? e.intersectionRect.height : 0);
        }
        if (Date.now() < jumpQuiet.current || rotateHold.current) return;
        let best = -1;
        let most = 0;
        for (const [i, h] of visible) {
          if (h > most) {
            most = h;
            best = i;
          }
        }
        if (best >= 0) {
          inView.current = best;
          reportCurrent.current(best);
        }
      },
      { root, threshold: Array.from({ length: 21 }, (_, i) => i / 20) },
    );
    for (const el of sheetRefs.current.slice(0, documents.length)) if (el) io.observe(el);
    return () => io.disconnect();
  }, [docsKey, fullscreen, documents.length]);

  const jump = (ctl: ReactZoomPanPinchContentRef, i: number) => {
    const sheet = sheetRefs.current[i];
    const { wrapperComponent: wrapper, contentComponent: content, state } = ctl.instance;
    if (!sheet || !wrapper || !content) return;
    const offset =
      sheet.getBoundingClientRect().top - wrapper.getBoundingClientRect().top - JUMP_TOP;
    const lowest = Math.min(0, wrapper.clientHeight - content.offsetHeight * state.scale);
    const y = Math.min(0, Math.max(lowest, state.positionY - offset));
    jumpQuiet.current = Date.now() + JUMP_MS + 100;
    rotateHold.current = false;
    inView.current = i;
    reportCurrent.current(i);
    ctl.setTransform(state.positionX, y, state.scale, JUMP_MS, "easeOut");
  };

  const docName = (d: ViewerDocument, i: number) =>
    d.label ?? d.filename ?? t("documentN", { n: i + 1 });

  const rotate = () => {
    const d = documents[Math.min(inView.current, documents.length - 1)];
    if (!d) return;
    rotateHold.current = true;
    setTurns((prev) => ({ ...prev, [d.src]: ((prev[d.src] ?? 0) + 90) % 360 }));
  };

  useFocusTrap(fullscreen, containerRef);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFullscreen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

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

  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  const pdfWidth = width ? Math.min(width - 24, 1100) : 600;

  const pixelRatio = useMemo(() => {
    if (!anyPdf || !pdfWidth) return undefined;
    const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    const base = coarse ? Math.min(dpr, 2) : Math.max(2, dpr);
    const share = Math.max(base, MAX_CANVAS_WIDTH / pdfWidth / Math.sqrt(Math.max(1, totalPages)));
    return Math.max(1, Math.min(base * zoom, share));
  }, [anyPdf, pdfWidth, zoom, totalPages, coarse]);

  if (documents.length === 0) return null;

  const content = (
    <TransformWrapper
      minScale={0.5}
      maxScale={10}
      panning={{ excluded: [TEXT_EXCLUDE] }}
      doubleClick={{ mode: "zoomIn", excluded: [TEXT_EXCLUDE] }}
      wheel={{ step: 0.005, wheelDisabled: true }}
      trackPadPanning={{ disabled: false }}
      // Pan on the compositor (translate3d). The library defaults to 2D because 3D blurs SVG on Safari.
      customTransform={(x, y, scale) => `translate3d(${x}px, ${y}px, 0) scale(${scale})`}
      // Settled before it reaches state: re-rasterising an A4 page every frame costs too much.
      onTransform={(_ref, state) => {
        const scale = state.scale;
        // Back at the scale we last rendered: any pending settle is aimed at the wrong number.
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
      {(ctl) => (
        <>
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-control border border-border bg-background/90 p-1 shadow-sm backdrop-blur">
            <ToolBtn label={t("zoomOut")} onClick={() => ctl.zoomOut()}>
              −
            </ToolBtn>
            <ToolBtn label={t("zoomIn")} onClick={() => ctl.zoomIn()}>
              +
            </ToolBtn>
            <ToolBtn label={t("reset")} onClick={() => ctl.resetTransform()}>
              <ResetIcon />
            </ToolBtn>
            <ToolBtn label={t("rotate")} onClick={rotate}>
              <RotateIcon />
            </ToolBtn>
            <span className="mx-0.5 h-5 w-px bg-border" />
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
                  <span className="hidden text-xs font-medium sm:inline">{t("fullscreen")}</span>
                </>
              )}
            </ToolBtn>
          </div>

          {navigation && <JumpOnRequest request={navigation.jumpTo} onJump={(i) => jump(ctl, i)} />}
          {documents.length > 1 && !navigation && (
            <JumpBar
              items={documents.map((d, i) => ({ key: d.src, name: docName(d, i) }))}
              onJump={(i) => jump(ctl, i)}
              register={registerBar}
            />
          )}

          <TransformComponent
            wrapperStyle={{ width: "100%", height: "100%" }}
            contentStyle={{
              width: "100%",
              minHeight: "100%",
              alignItems: "center",
              justifyContent: "center",
              padding: "0.5rem",
              willChange: "transform",
            }}
          >
            <div
              ref={stackRef}
              className={cn(
                "flex w-full flex-col items-center gap-10",
                documents.length > 1 && "pb-14 pt-10",
              )}
            >
              {documents.map((d, i) => (
                <div
                  key={d.src}
                  ref={(el) => {
                    sheetRefs.current[i] = el;
                  }}
                  data-sheet={i}
                  className="w-full"
                >
                  <DocumentSheet
                    doc={d}
                    position={
                      documents.length > 1
                        ? {
                            index: i,
                            total: documents.length,
                            name: docName(d, i),
                          }
                        : undefined
                    }
                    width={pdfWidth}
                    pixelRatio={pixelRatio}
                    turn={turns[d.src] ?? 0}
                    selectable={!coarse}
                    onPages={reportPages}
                  />
                </div>
              ))}
            </div>
          </TransformComponent>
        </>
      )}
    </TransformWrapper>
  );

  if (fullscreen) {
    return createPortal(
      <div
        ref={containerRef}
        onPointerDown={startDrag}
        className={cn("fixed inset-0 z-100 touch-none overflow-hidden bg-black/90", cursor)}
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
      className={cn("relative touch-none overflow-hidden bg-surface", cursor, className)}
    >
      {content}
    </div>
  );
}

function DocumentSheet({
  doc,
  position,
  width,
  pixelRatio,
  turn,
  selectable,
  onPages,
}: {
  doc: ViewerDocument;
  position?: { index: number; total: number; name: string };
  width: number;
  pixelRatio: number | undefined;
  turn: number;
  selectable: boolean;
  onPages: (src: string, pages: number) => void;
}) {
  const t = useTranslations("receipt");
  const [numPages, setNumPages] = useState(0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const fetched = !doc.src.startsWith("blob:");
  const fileSrc = attempt && fetched ? `${doc.src}?retry=${attempt}` : doc.src;
  const retry = () => {
    setFailed(false);
    setAttempt((n) => n + 1);
  };

  const isPdf = doc.mimeType === "application/pdf";

  const [ownRotation, setOwnRotation] = useState<Record<number, number>>({});
  const pageRotation = (i: number) =>
    turn !== 0 && i in ownRotation ? (ownRotation[i] + turn) % 360 : undefined;

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const quarter = turn === 90 || turn === 270;
  const fit = natural && quarter ? Math.min(1, width / natural.h) : 1;

  useEffect(() => () => onPages(doc.src, 0), [doc.src, onPages]);

  return (
    <div className="flex w-full flex-col items-center">
      {position && (
        <div className="mb-3 flex w-full items-center gap-3">
          <span aria-hidden className="h-px flex-1 bg-border" />
          <p className="flex min-w-0 max-w-[85%] items-center gap-2 rounded-control border border-border bg-background px-3 py-1 text-xs font-medium text-foreground shadow-sm">
            <span className="shrink-0 tabular-nums text-muted">
              {position.index + 1}/{position.total}
            </span>
            <span className="truncate">{position.name}</span>
          </p>
          <span aria-hidden className="h-px flex-1 bg-border" />
        </div>
      )}
      {isPdf ? (
        <Document
          key={fileSrc}
          file={fileSrc}
          onLoadSuccess={({ numPages: n }) => {
            setNumPages(n);
            onPages(doc.src, n);
          }}
          loading={<PdfLoading />}
          error={<LoadFailed onRetry={retry} pdfHref={doc.src} />}
          className="flex flex-col items-center gap-2"
        >
          {Array.from({ length: numPages }, (_, i) => (
            <Page
              key={i}
              pageNumber={i + 1}
              width={width}
              rotate={pageRotation(i)}
              onLoadSuccess={(page) =>
                setOwnRotation((prev) =>
                  prev[i] === page.rotate ? prev : { ...prev, [i]: page.rotate },
                )
              }
              devicePixelRatio={pixelRatio}
              renderTextLayer={selectable}
              renderAnnotationLayer={false}
              className="overflow-hidden rounded-mark shadow-[var(--shadow-card)] [&_.textLayer]:select-text"
              loading=""
            />
          ))}
        </Document>
      ) : failed ? (
        <LoadFailed onRetry={retry} />
      ) : natural && quarter ? (
        <div
          className="relative shrink-0"
          style={{ width: natural.h * fit, height: natural.w * fit }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fileSrc}
            alt={doc.filename ?? t("alt")}
            draggable={false}
            onError={() => setFailed(true)}
            className="absolute left-1/2 top-1/2 max-w-none select-none rounded-mark shadow-[var(--shadow-card)]"
            style={{
              width: natural.w * fit,
              height: natural.h * fit,
              transform: `translate(-50%, -50%) rotate(${turn}deg)`,
            }}
          />
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={fileSrc}
          alt={doc.filename ?? t("alt")}
          draggable={false}
          onLoad={(e) =>
            setNatural({
              w: e.currentTarget.naturalWidth,
              h: e.currentTarget.naturalHeight,
            })
          }
          onError={() => setFailed(true)}
          className="max-w-full select-none rounded-mark shadow-[var(--shadow-card)]"
          style={turn ? { transform: `rotate(${turn}deg)` } : undefined}
        />
      )}
    </div>
  );
}

function JumpOnRequest({
  request,
  onJump,
}: {
  request: { index: number; seq: number } | null;
  onJump: (i: number) => void;
}) {
  const jumpRef = useRef(onJump);
  useEffect(() => {
    jumpRef.current = onJump;
  });
  const seq = request?.seq;
  const index = request?.index;
  useEffect(() => {
    if (seq === undefined || index === undefined) return;
    jumpRef.current(index);
  }, [seq, index]);
  return null;
}

function JumpBar({
  items,
  onJump,
  register,
}: {
  items: { key: string; name: string }[];
  onJump: (i: number) => void;
  register: (set: ((i: number) => void) | null) => void;
}) {
  const t = useTranslations("receipt");
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    register(setCurrent);
    return () => register(null);
  }, [register]);
  const shown = Math.min(current, items.length - 1);

  return (
    // No safe-area inset of its own: the panel around the viewer keeps clear of the
    // home indicator already, and both counting it doubled the gap.
    <div className="absolute bottom-3 left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-1 rounded-control border border-border bg-background/90 p-1 shadow-sm backdrop-blur">
      <ToolBtn
        label={t("previousDocument")}
        onClick={() => onJump(shown - 1)}
        disabled={shown === 0}
      >
        <IconChevronLeft className="size-4" />
      </ToolBtn>
      <label className="relative flex min-w-0">
        <span className="sr-only">{t("jumpTo")}</span>
        <select
          value={shown}
          onChange={(e) => onJump(Number(e.target.value))}
          className="h-7 max-w-64 min-w-0 cursor-pointer appearance-none truncate rounded-control bg-transparent pl-2 pr-7 text-xs font-medium text-foreground transition-colors hover:bg-hover"
        >
          {items.map((item, i) => (
            <option key={item.key} value={i}>
              {`${i + 1}/${items.length} - ${item.name}`}
            </option>
          ))}
        </select>
        <IconChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
      </label>
      <ToolBtn
        label={t("nextDocument")}
        onClick={() => onJump(shown + 1)}
        disabled={shown === items.length - 1}
      >
        <IconChevronRight className="size-4" />
      </ToolBtn>
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
  title?: string;
  onClick: () => void;
  disabled?: boolean;
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
        "flex items-center justify-center rounded-control text-[15px] leading-none text-foreground transition-colors hover:bg-hover disabled:opacity-30",
        wide ? "h-7 gap-1.5 px-2" : "size-7",
      )}
    >
      {children}
    </button>
  );
}

function PdfLoading() {
  const t = useTranslations("receipt");
  return (
    <div role="status" className="flex items-center gap-2.5 p-6 text-sm text-muted">
      <Spinner size="md" />
      {t("loadingPdf")}
    </div>
  );
}

function LoadFailed({ onRetry, pdfHref }: { onRetry: () => void; pdfHref?: string }) {
  const t = useTranslations("receipt");
  return (
    <div className="flex max-w-xs flex-col items-center gap-2 p-6 text-center">
      <p className="text-sm font-medium text-foreground">{t("loadFailed")}</p>
      <p className="text-xs text-muted">{t("loadFailedHint")}</p>
      <div className="mt-1 flex items-center gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          {t("retry")}
        </Button>
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

const RotateIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="size-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 5H6a2 2 0 0 0-2 2v3" />
    <path d="m9 8 3-3-3-3" />
    <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
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
