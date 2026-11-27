"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { ReceiptViewer, type ViewerDocument } from "@/components/receipt/receipt-viewer";
import { DocumentStrip } from "@/components/receipt/document-strip";
import { NO_PANEL, arrivalAction, type PanelState } from "@/lib/ui/receipt-arrival";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  IconChevronDown,
  IconChevronRight,
  IconReceipt,
  IconUpload,
  IconX,
} from "@/components/ui/icons";
import { cn } from "@/lib/ui/utils";
import { usePhone } from "@/lib/ui/media";
import {
  RECEIPT_COLLAPSED_COOKIE,
  RECEIPT_MAX_FRACTION,
  RECEIPT_MIN_WIDTH,
  RECEIPT_WIDTH_COOKIE,
} from "@/lib/ui/receipt-panel-cookies";

const RECEIPT_FOLD_MS = 320;

const MIN_WIDTH = RECEIPT_MIN_WIDTH;
const MAX_FRACTION = RECEIPT_MAX_FRACTION;

/** The panel's width for CSS: a share of the frame it lies in, never under MIN_WIDTH. */
const widthCss = (share: number) => `max(${MIN_WIDTH}px, ${(share * 100).toFixed(2)}%)`;

const FLOATING_BTN =
  "flex size-7 items-center justify-center rounded-control border border-border bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-hover";

export interface UploadCopy {
  lead?: string;
  leadShort?: string;
  fileTypes?: string;
  action?: string;
  addLabel?: string;
}

type Source = {
  docs: ViewerDocument[];
  upload?: {
    onFile: (file: File) => void;
    uploading: boolean;
    copy?: UploadCopy;
    multiple?: boolean;
  };
  empty?: { title: string; description?: string };
  arrange?: Arrange;
  /** The page decides when the panel shows, by which documents it gives it (the Inkorg: the one picked). On a phone the
   *  panel is open exactly while it has documents, and its close button calls this to clear them. On a wide screen it
   *  opens when the documents change and folds as any other. */
  onClose?: () => void;
};

export interface Arrange {
  keys: string[];
  onReorder: (keys: string[]) => void;
  onRemove: (key: string) => void;
  disabled?: boolean;
}

type Ctx = {
  source: Source | null;
  setSource: (s: Source | null) => void;
  collapsed: boolean;
  setCollapsed: (next: boolean, persist?: boolean) => void;
  /** A share of the frame, 0 to MAX_FRACTION. */
  width: number;
  setWidth: (w: number) => void;
  footerSlot: HTMLElement | null;
  setFooterSlot: (el: HTMLElement | null) => void;
  coverSlot: HTMLElement | null;
  setCoverSlot: (el: HTMLElement | null) => void;
  /** How many ReceiptPanelCovers are mounted. While any is, the documents are hidden under it. */
  covers: number;
  setCovers: React.Dispatch<React.SetStateAction<number>>;
  /** Bumped to ask the column to open, with its slide-in: the phone's receipt row lives in the page. */
  openRequests: number;
  requestOpen: () => void;
};

const PanelCtx = createContext<Ctx | null>(null);

function usePanel(): Ctx {
  const ctx = useContext(PanelCtx);
  if (!ctx) throw new Error("Receipt panel used outside ReceiptPanelProvider");
  return ctx;
}

export function useReceiptTabShowing(): boolean {
  const { source, collapsed } = usePanel();
  return Boolean(source) && collapsed && !isAwaitingUpload(source);
}

/** The page's documents, for showing them outside the panel (the phone's receipt row). Null while it has none. */
export function useReceiptDocuments(): ViewerDocument[] | null {
  return usePanel().source?.docs ?? null;
}

/** Open the panel the way its own tab does, sliding in. For a control outside it (the phone's receipt row). */
export function useOpenReceiptPanel(): () => void {
  return usePanel().requestOpen;
}

const isAwaitingUpload = (source: Source | null) =>
  Boolean(source && source.docs.length === 0 && source.upload);

const writeCookie = (name: string, value: string) => {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
};

export function ReceiptPanelProvider({
  defaultCollapsed,
  defaultWidth,
  children,
}: {
  defaultCollapsed: boolean;
  defaultWidth: number;
  children: React.ReactNode;
}) {
  const [source, setSource] = useState<Source | null>(null);
  const [collapsed, setCollapsedState] = useState(defaultCollapsed);
  const [width, setWidthState] = useState(defaultWidth);
  const [footerSlot, setFooterSlot] = useState<HTMLElement | null>(null);
  const [coverSlot, setCoverSlot] = useState<HTMLElement | null>(null);
  const [covers, setCovers] = useState(0);
  const [openRequests, setOpenRequests] = useState(0);
  const requestOpen = useCallback(() => setOpenRequests((n) => n + 1), []);

  const setCollapsed = useCallback((next: boolean, persist = true) => {
    setCollapsedState(next);
    if (persist) writeCookie(RECEIPT_COLLAPSED_COOKIE, next ? "1" : "0");
  }, []);

  const setWidth = useCallback((w: number) => setWidthState(w), []);

  const value = useMemo(
    () => ({
      source,
      setSource,
      collapsed,
      setCollapsed,
      width,
      setWidth,
      footerSlot,
      setFooterSlot,
      coverSlot,
      setCoverSlot,
      covers,
      setCovers,
      openRequests,
      requestOpen,
    }),
    [
      source,
      collapsed,
      setCollapsed,
      width,
      setWidth,
      footerSlot,
      coverSlot,
      covers,
      openRequests,
      requestOpen,
    ],
  );

  return <PanelCtx.Provider value={value}>{children}</PanelCtx.Provider>;
}

export function ReceiptPanelSource({
  documents,
  receiptId = null,
  documentUrl,
  previewUrl,
  mimeType,
  filename,
  onFile,
  uploading = false,
  multiple = false,
  uploadCopy,
  emptyTitle,
  emptyDescription,
  arrange,
  onClose,
}: {
  documents?: ViewerDocument[];
  receiptId?: string | null;
  documentUrl?: string | null;
  previewUrl?: string | null;
  mimeType?: string;
  filename?: string;
  onFile?: (file: File) => void;
  uploading?: boolean;
  multiple?: boolean;
  uploadCopy?: UploadCopy;
  emptyTitle?: string;
  emptyDescription?: string;
  arrange?: Arrange;
  /** See Source.onClose. */
  onClose?: () => void;
}) {
  const { setSource } = usePanel();

  const arrangeRef = useRef(arrange);
  useEffect(() => {
    arrangeRef.current = arrange;
  });
  const arrangeKey = arrange ? JSON.stringify([arrange.keys, Boolean(arrange.disabled)]) : "";
  const stableArrange = useMemo<Arrange | undefined>(() => {
    if (!arrangeKey) return undefined;
    const [keys, disabled] = JSON.parse(arrangeKey) as [string[], boolean];
    return {
      keys,
      disabled,
      onReorder: (next) => arrangeRef.current?.onReorder(next),
      onRemove: (key) => arrangeRef.current?.onRemove(key),
    };
  }, [arrangeKey]);

  const handler = useRef(onFile);
  useEffect(() => {
    handler.current = onFile;
  });
  const accepts = Boolean(onFile);
  const stableOnFile = useCallback((file: File) => handler.current?.(file), []);

  const closer = useRef(onClose);
  useEffect(() => {
    closer.current = onClose;
  });
  const closable = Boolean(onClose);
  const stableOnClose = useCallback(() => closer.current?.(), []);

  const copyKey = JSON.stringify(uploadCopy ?? null);
  const copyRef = useRef(uploadCopy);
  useEffect(() => {
    copyRef.current = uploadCopy;
  });

  const shorthand = previewUrl ?? documentUrl ?? (receiptId ? `/api/receipts/${receiptId}` : null);
  const docs: ViewerDocument[] =
    documents ??
    (shorthand ? [{ src: shorthand, mimeType: mimeType ?? "application/pdf", filename }] : []);

  const docsKey = JSON.stringify(docs);
  const docsRef = useRef(docs);
  useEffect(() => {
    docsRef.current = docs;
  });

  useEffect(() => {
    if (docsRef.current.length === 0 && !accepts && !emptyTitle) {
      setSource(null);
      return;
    }
    setSource({
      docs: docsRef.current,
      upload: accepts
        ? { onFile: stableOnFile, uploading, copy: copyRef.current, multiple }
        : undefined,
      empty: emptyTitle ? { title: emptyTitle, description: emptyDescription } : undefined,
      arrange: stableArrange,
      onClose: closable ? stableOnClose : undefined,
    });
    return () => setSource(null);
  }, [
    docsKey,
    copyKey,
    accepts,
    uploading,
    multiple,
    stableOnFile,
    emptyTitle,
    emptyDescription,
    stableArrange,
    closable,
    stableOnClose,
    setSource,
  ]);

  return null;
}

export function ReceiptPanelFooter({ children }: { children: React.ReactNode }) {
  const { footerSlot } = usePanel();
  return footerSlot ? createPortal(children, footerSlot) : null;
}

/**
 * Something to read in the panel in place of the documents, such as the mail they came in. The documents stay
 * mounted underneath, so going back to them keeps their page and zoom. The footer stays.
 */
export function ReceiptPanelCover({ children }: { children: React.ReactNode }) {
  const { coverSlot, setCovers } = usePanel();
  useEffect(() => {
    setCovers((n) => n + 1);
    return () => setCovers((n) => n - 1);
  }, [setCovers]);
  return coverSlot ? createPortal(children, coverSlot) : null;
}

export function ReceiptPanelColumn() {
  const {
    source,
    collapsed,
    setCollapsed,
    width,
    setWidth,
    setFooterSlot,
    setCoverSlot,
    covers,
    openRequests,
    requestOpen,
  } = usePanel();
  const covered = covers > 0;
  const t = useTranslations("receipt");
  const widthRef = useRef(width);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState(false);
  const dragDepth = useRef(0);
  const [currentDoc, setCurrentDoc] = useState(0);
  const [jumpTo, setJumpTo] = useState<{ index: number; seq: number } | null>(null);

  const [leaving, setLeaving] = useState(false);
  const [entering, setEntering] = useState(false);
  const [arriving, setArriving] = useState(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const narrow = usePhone();
  const awaitingUpload = isAwaitingUpload(source);
  // On a phone a page with onClose decides: open while it gives documents, closed otherwise (no dropzone).
  const owned = narrow && Boolean(source?.onClose);
  const open = owned
    ? Boolean(source && source.docs.length > 0)
    : !collapsed || (awaitingUpload && !narrow);

  const was = useRef<PanelState>(NO_PANEL);
  useEffect(() => {
    const now: PanelState = {
      source: Boolean(source),
      receipt: Boolean(source && source.docs.length > 0),
      awaiting: awaitingUpload,
      docs: source?.docs.map((d) => d.src).join("|") ?? "",
    };
    const phone = window.matchMedia("(max-width: 767px)").matches;
    const before = was.current;
    was.current = now;
    // The page owns open and closed on a phone (Source.onClose): no rule of the panel's own applies.
    if (phone && source?.onClose) return;
    // Decided in the one place that sees the documents change, so no other rule runs after it (lib/ui/receipt-arrival).
    const action = arrivalAction(before, now, { phone, openOnChange: Boolean(source?.onClose) });
    if (action === "open") requestOpen();
    else if (action === "fold") setCollapsed(true, false);
    else if (action === "unfold") setCollapsed(false, false);
  }, [source, awaitingUpload, setCollapsed, requestOpen]);

  // A request to open (the phone's receipt row, or the arrival rule for a page that asked) slides it in. In an effect,
  // not during render: opening sets the provider's state, which no component may do while another renders.
  const seenRequests = useRef(openRequests);
  useEffect(() => {
    if (seenRequests.current === openRequests) return;
    seenRequests.current = openRequests;
    setLeaving(false);
    // Already open (another document picked in the Inkorg): nothing to slide in.
    setEntering(collapsed);
    setCollapsed(false);
  }, [openRequests, collapsed, setCollapsed]);

  // Opened by the page on a phone (Source.onClose): slide in, as the panel's own opening does. A layout effect, so the
  // starting position is set before the browser paints the panel at its end.
  const wasOpen = useRef(open);
  useLayoutEffect(() => {
    if (owned && open && !wasOpen.current) setEntering(true);
    wasOpen.current = open;
  }, [owned, open]);

  // Two frames, not one: a single rAF can still be coalesced into the commit that
  // mounted the panel, and a browser that has never painted the starting value has
  // nothing to transition from, which is the bug this whole dance is about.
  useEffect(() => {
    if (!entering) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setEntering(false));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [entering]);

  useEffect(() => {
    if (!open || !source) return;
    const mobile = window.matchMedia("(max-width: 767px)");
    if (!mobile.matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, source]);

  const panelRef = useRef<HTMLElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef<HTMLButtonElement>(null);
  const handBackFocus = useRef(false);

  useLayoutEffect(() => {
    if (open || !handBackFocus.current) return;
    handBackFocus.current = false;
    tabRef.current?.focus();
  }, [open]);
  const frame = useRef(0);
  const pending = useRef(0);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const panel = panelRef.current;
    const frameWidth =
      (panel?.offsetParent as HTMLElement | null)?.clientWidth || window.innerWidth;
    const startWidth = panel?.getBoundingClientRect().width ?? widthRef.current * frameWidth;
    setDragging(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    // Dragged in pixels, kept as a share of the frame.
    const paint = () => {
      frame.current = 0;
      widthRef.current = pending.current;
      panelRef.current?.style.setProperty("--receipt-w", widthCss(pending.current));
      spacerRef.current?.style.setProperty("--receipt-w", widthCss(pending.current));
    };

    const onMove = (ev: PointerEvent) => {
      const max = Math.max(MIN_WIDTH, frameWidth * MAX_FRACTION);
      const px = Math.min(max, Math.max(MIN_WIDTH, startWidth + (startX - ev.clientX)));
      pending.current = Math.min(MAX_FRACTION, px / frameWidth);
      if (!frame.current) frame.current = requestAnimationFrame(paint);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      const final = pending.current;
      widthRef.current = final;
      setWidth(final);
      setDragging(false);
      writeCookie(RECEIPT_WIDTH_COOKIE, final.toFixed(3));
    };
    pending.current = widthRef.current;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (!source) return null;

  const upload = source.upload;
  const pick = () => fileInput.current?.click();

  const foldAway = () => {
    // The page's to close: it clears the documents, and the panel goes with them.
    if (owned) {
      source.onClose?.();
      return;
    }
    handBackFocus.current = panelRef.current?.contains(document.activeElement) ?? false;
    setEntering(false);
    setLeaving(true);
    setArriving(true);
    setCollapsed(true);
    timers.current.push(
      window.setTimeout(() => setLeaving(false), RECEIPT_FOLD_MS),
      window.setTimeout(() => setArriving(false), 1100),
    );
  };

  const unfold = () => {
    setLeaving(false);
    setEntering(true);
    setCollapsed(false);
  };

  const take = (list: FileList | null | undefined) => {
    if (!upload || upload.uploading) return;
    const files = Array.from(list ?? []);
    for (const file of upload.multiple ? files : files.slice(0, 1)) upload.onFile(file);
  };

  const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  const dropHandlers = upload
    ? {
        onDragEnter: (e: React.DragEvent) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          dragDepth.current += 1;
          setOver(true);
        },
        onDragOver: (e: React.DragEvent) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = upload.uploading ? "none" : "copy";
        },
        onDragLeave: (e: React.DragEvent) => {
          if (!isFileDrag(e)) return;
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setOver(false);
        },
        onDrop: (e: React.DragEvent) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          dragDepth.current = 0;
          setOver(false);
          take(e.dataTransfer.files);
        },
      }
    : {};

  const controls = (
    // Absolute, so the panel's own safe-area padding does not move it: it adds the
    // inset itself below md, where the panel covers the screen.
    <div className="absolute left-2 top-[calc(env(safe-area-inset-top)+0.5rem)] z-20 flex items-center gap-1.5 md:top-2">
      {(!awaitingUpload || narrow) && (
        <button
          type="button"
          onClick={foldAway}
          title={narrow ? t("close") : t("collapse")}
          aria-label={narrow ? t("close") : t("collapse")}
          aria-expanded
          className={FLOATING_BTN}
        >
          <IconChevronRight className="hidden size-4 md:block" />
          <IconX className="size-4 md:hidden" />
        </button>
      )}
      {upload && source.docs.length > 0 && (
        <button
          type="button"
          onClick={pick}
          disabled={upload.uploading}
          title={upload.copy?.addLabel ?? t("replace")}
          aria-label={upload.copy?.addLabel ?? t("replace")}
          className={cn(FLOATING_BTN, "disabled:opacity-40")}
        >
          {upload.uploading ? <Spinner size="sm" /> : <IconUpload className="size-4" />}
        </button>
      )}
    </div>
  );

  const arrange = source.arrange;
  const body =
    source.docs.length > 0 ? (
      arrange ? (
        <>
          <ReceiptViewer
            documents={source.docs}
            className="min-h-0 flex-1"
            navigation={{ jumpTo, onCurrentChange: setCurrentDoc }}
          />
          <DocumentStrip
            items={source.docs.map((d, i) => ({ ...d, key: arrange.keys[i] ?? d.src }))}
            current={Math.min(currentDoc, source.docs.length - 1)}
            onSelect={(index) => {
              setCurrentDoc(index);
              setJumpTo((j) => ({ index, seq: (j?.seq ?? 0) + 1 }));
            }}
            onReorder={arrange.onReorder}
            onRemove={arrange.onRemove}
            onAdd={upload ? pick : undefined}
            disabled={Boolean(arrange.disabled) || Boolean(upload?.uploading)}
          />
        </>
      ) : (
        <ReceiptViewer documents={source.docs} className="min-h-0 flex-1" />
      )
    ) : !upload ? (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center text-muted">
        <IconReceipt className="size-8" />
        <p className="mt-3 text-sm font-medium text-foreground">{source.empty?.title}</p>
        {source.empty?.description && (
          <p className="mt-1 max-w-[22rem] text-xs">{source.empty.description}</p>
        )}
      </div>
    ) : (
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center transition-colors",
          over && "bg-accent-soft/40",
        )}
      >
        {upload?.uploading ? (
          <div role="status" className="flex flex-col items-center">
            <span className="flex size-12 items-center justify-center rounded-control bg-accent-soft text-accent">
              <Spinner size="lg" />
            </span>
            <p className="mt-4 text-sm font-medium">{t("uploading")}</p>
            <p className="mt-1 text-xs text-muted">{t("uploadingHint")}</p>
          </div>
        ) : (
          <>
            <span className="flex size-12 items-center justify-center rounded-control bg-accent-soft text-accent">
              <IconUpload className="size-6" />
            </span>
            <p className="mt-4 hidden text-sm font-medium md:block">
              {upload?.copy?.lead ?? t("dropzone")}
            </p>
            <p className="mt-4 text-sm font-medium md:hidden">
              {upload?.copy?.leadShort ?? t("pickReceiptLead")}
            </p>
            <p className="mt-1 text-xs text-muted">{upload?.copy?.fileTypes ?? t("fileTypes")}</p>
            <Button className="mt-5" onClick={pick}>
              <IconUpload className="size-4" />
              {upload?.copy?.action ?? t("pickReceipt")}
            </Button>
          </>
        )}
      </div>
    );

  const viewer = (
    <>
      {controls}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Laid out at full size under a cover, never display: none. A viewer with no size refits when it is shown
            again, and the page would visibly snap into place. Invisible, so it is not read or tabbed into. */}
        <div className={cn("flex min-h-0 flex-1 flex-col", covered && "invisible")}>{body}</div>
        {/* Over the documents, below the floating controls (z-20), which sit over its top left. */}
        <div
          ref={setCoverSlot}
          className={
            covered ? "absolute inset-0 z-10 overflow-y-auto bg-background pt-12" : "hidden"
          }
        />
      </div>
      {over && source.docs.length > 0 && !upload?.uploading && (
        <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center bg-background/80 text-center backdrop-blur-sm">
          <span className="flex size-12 items-center justify-center rounded-control bg-accent-soft text-accent">
            <IconUpload className="size-6" />
          </span>
          <p className="mt-4 text-sm font-medium">{upload?.copy?.addLabel ?? t("replace")}</p>
        </div>
      )}
      <div
        ref={setFooterSlot}
        className="shrink-0 border-t border-border bg-background empty:hidden"
      />
      {upload && (
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
          multiple={upload.multiple}
          className="hidden"
          onChange={(e) => {
            take(e.target.files);
            e.target.value = "";
          }}
        />
      )}
    </>
  );

  const tab = (
    <button
      ref={tabRef}
      type="button"
      onClick={unfold}
      title={t("expand")}
      aria-expanded={false}
      className={cn(
        "fixed z-30 hidden items-center justify-center gap-2 md:flex print:hidden",
        "bottom-0 left-0 right-0 rounded-t-panel px-4 pt-4",
        "md:bottom-auto md:left-auto md:right-0 md:top-1/2 md:-translate-y-1/2",
        "md:flex-col md:gap-1.5 md:rounded-l-panel md:rounded-tr-none md:px-2.5 md:pb-3.5 md:pt-3.5",
        // White with a pink edge and icons, the label in ink: the brand pink is too light for text.
        "border-b-0 border-l-0 border-r-0 border-t border-brand md:border-b md:border-l",
        "bg-background text-foreground shadow-[var(--shadow-card)] transition-colors hover:bg-action-from/10",
        arriving && "receipt-tab-arriving",
      )}
    >
      <IconReceipt className="size-5 shrink-0 text-brand md:size-4" />
      <span className="text-sm font-medium leading-none tracking-wide md:text-[11px] md:[writing-mode:vertical-rl]">
        {t("tab")}
      </span>
      <IconChevronDown className="size-4 shrink-0 rotate-180 text-brand md:order-first md:rotate-90" />
    </button>
  );

  const leavingNow = leaving && !open;

  return (
    <>
      {(open || leavingNow) && (
        <div
          ref={spacerRef}
          aria-hidden
          style={{ "--receipt-w": widthCss(width) } as React.CSSProperties}
          className={cn(
            "hidden shrink-0 md:block md:max-w-[70vw] print:hidden",
            !dragging && "receipt-spacer",
            entering || leavingNow ? "w-0" : "w-[var(--receipt-w)]",
          )}
        />
      )}
      {(open || leavingNow) && (
        <aside
          ref={panelRef}
          inert={leavingNow}
          {...dropHandlers}
          style={{ "--receipt-w": widthCss(width) } as React.CSSProperties}
          className={cn(
            "flex flex-col bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:pt-0 md:pb-0 print:hidden",
            "receipt-panel fixed inset-y-0 left-0 right-0 z-40",
            (entering || leavingNow) && "receipt-panel-moving",
            "md:absolute md:left-auto md:z-20 md:w-[var(--receipt-w)] md:max-w-[70vw] md:border-l md:border-border",
            leavingNow
              ? "pointer-events-none translate-y-full md:translate-x-full md:translate-y-0"
              : entering && "translate-y-full md:translate-x-full md:translate-y-0",
          )}
        >
          <div
            onPointerDown={startDrag}
            role="separator"
            aria-orientation="vertical"
            aria-label={t("resize")}
            className={cn(
              "absolute inset-y-0 left-0 z-30 hidden w-3 cursor-col-resize touch-none transition-colors md:block",
              dragging ? "bg-accent/40" : "hover:bg-accent/30",
            )}
          />
          {viewer}
        </aside>
      )}
      {!open && tab}
    </>
  );
}
