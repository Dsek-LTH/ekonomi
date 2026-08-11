"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { ReceiptViewer } from "@/components/receipt/receipt-viewer";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  IconChevronLeft,
  IconChevronRight,
  IconReceipt,
  IconUpload,
  IconX,
} from "@/components/ui/icons";
import { cn } from "@/lib/ui/utils";

// The receipt as part of the app frame rather than part of the page.
//
// Inside the page it was always a card in a column: it started below the page
// header, ended above the page's bottom padding, and scrolled away with
// everything else. Beside a voucher table that is the wrong thing — what a
// receipt is for is being read *while* you work, so here it stands floor to
// ceiling next to the main column, keeps still while the page scrolls under it,
// and folds to a rail when the work needs the width instead.
//
// It's app chrome, but the receipt in it belongs to whichever page is open, so
// a page declares one with <ReceiptPanelSource>; the column lives in AppShell
// and renders nothing at all until some page has.

export const RECEIPT_COLLAPSED_COOKIE = "receipt_collapsed";
export const RECEIPT_WIDTH_COOKIE = "receipt_width";

/** Narrow enough is still an A4 page at fit-width; past 70% the page it sits
 *  beside stops being usable, which is the thing the panel exists to serve. */
const MIN_WIDTH = 360;
const MAX_FRACTION = 0.7;
export const DEFAULT_WIDTH = 520;

// The panel's own controls, matching the viewer's zoom toolbar in the opposite
// corner so the two read as one set of tools rather than two.
const FLOATING_BTN =
  "flex size-7 items-center justify-center rounded-full border border-border bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-surface";

type Source = {
  /**
   * Where to read the receipt from — the archive, or a local URL for one the
   * page is still holding (the wizard keeps the picked file in the browser
   * until the utlägg is saved). The panel doesn't care which: showing a receipt
   * is showing whatever is at this address, and "is there one" is this being
   * set at all.
   */
  src: string | null;
  mimeType: string;
  /** Only the image's alt text — the panel itself is never titled. */
  filename?: string;
  /**
   * Offered by a page where the receipt is still being put there — the wizard.
   * With one of these the panel stays even with nothing to show, and the empty
   * panel is the dropzone: "where the receipt lives" and "where you put it"
   * are the same place, so neither needs a step of its own.
   */
  upload?: { onFile: (file: File) => void; uploading: boolean };
  /**
   * Keeps the panel standing when there is no receipt, saying so in place of
   * showing one. A page that reads an utlägg alongside its underlag wants the
   * underlag's absence in the same place the underlag would have been — not as
   * a notice somewhere in the body, which moves the whole layout depending on
   * whether a receipt happens to exist.
   */
  empty?: { title: string; description?: string };
};

type Ctx = {
  source: Source | null;
  setSource: (s: Source | null) => void;
  collapsed: boolean;
  /** `persist: false` for a fold the situation asked for, not the reader. */
  setCollapsed: (next: boolean, persist?: boolean) => void;
  width: number;
  setWidth: (w: number) => void;
};

const PanelCtx = createContext<Ctx | null>(null);

function usePanel(): Ctx {
  const ctx = useContext(PanelCtx);
  if (!ctx) throw new Error("Receipt panel used outside ReceiptPanelProvider");
  return ctx;
}

/**
 * Whether the folded tab is currently hanging over the page. It's `fixed`, so
 * it takes no width of its own and would otherwise sit on top of whatever
 * reaches the right edge — the main column has to keep clear of it.
 */
export function useReceiptTabShowing(): boolean {
  const { source, collapsed } = usePanel();
  return Boolean(source) && collapsed && !isAwaitingUpload(source);
}

/** A page waiting for a receipt keeps the panel open — there'd be nothing to
 *  fold away, and folding is how you'd lose the only way to add one. */
const isAwaitingUpload = (source: Source | null) =>
  Boolean(source && !source.src && source.upload);

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

  const setCollapsed = useCallback((next: boolean, persist = true) => {
    setCollapsedState(next);
    if (persist) writeCookie(RECEIPT_COLLAPSED_COOKIE, next ? "1" : "0");
  }, []);

  // Written on pointer-up rather than on every move: a drag is a hundred
  // widths, and only the one you let go on is a preference.
  const setWidth = useCallback((w: number) => setWidthState(w), []);

  const value = useMemo(
    () => ({ source, setSource, collapsed, setCollapsed, width, setWidth }),
    [source, collapsed, setCollapsed, width, setWidth],
  );

  return <PanelCtx.Provider value={value}>{children}</PanelCtx.Provider>;
}

/**
 * Declares the document the panel should be showing while this page is mounted.
 * Renders nothing. Nothing to show takes the panel away entirely, rather than
 * leaving the last page's receipt standing — unless `onFile` is given, in which
 * case an empty panel is an invitation to upload one.
 *
 * Three ways to say where the file is, in the order they win: `previewUrl` (one
 * the page is still holding), `documentUrl` (an address the page knows), and
 * `receiptId` (a receipt in the archive, whose address is this component's to
 * build). A page gives whichever one it has.
 */
export function ReceiptPanelSource({
  receiptId = null,
  documentUrl,
  previewUrl,
  mimeType,
  filename,
  onFile,
  uploading = false,
  emptyTitle,
  emptyDescription,
}: {
  receiptId?: string | null;
  /**
   * A stored document that is not a receipt, addressed outright — the rendered
   * intäktsräkning behind an income report, served by its own route. The panel
   * shows whatever is at the address; being a receipt was never the part that
   * mattered to it.
   */
  documentUrl?: string | null;
  /**
   * A receipt the page has but the archive doesn't yet — an object URL for a
   * file just picked. Shown ahead of `receiptId`, so replacing a stored receipt
   * shows the new one from the moment it is chosen rather than the old one
   * until the save goes through.
   */
  previewUrl?: string | null;
  mimeType: string;
  filename?: string;
  /** Makes the panel accept a receipt as well as show one. */
  onFile?: (file: File) => void;
  uploading?: boolean;
  /** Given, the panel stays when there is no receipt and says this instead. */
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const { setSource } = usePanel();

  // Through a ref, so a handler redefined on every render of the page doesn't
  // re-register the source on every render — which would set state during
  // render forever.
  const handler = useRef(onFile);
  useEffect(() => {
    handler.current = onFile;
  });
  const accepts = Boolean(onFile);
  const stableOnFile = useCallback((file: File) => handler.current?.(file), []);
  const src =
    previewUrl ?? documentUrl ?? (receiptId ? `/api/receipts/${receiptId}` : null);

  useEffect(() => {
    if (!src && !accepts && !emptyTitle) {
      setSource(null);
      return;
    }
    setSource({
      src,
      mimeType,
      filename,
      upload: accepts ? { onFile: stableOnFile, uploading } : undefined,
      empty: emptyTitle ? { title: emptyTitle, description: emptyDescription } : undefined,
    });
    return () => setSource(null);
  }, [
    src,
    mimeType,
    filename,
    accepts,
    uploading,
    stableOnFile,
    emptyTitle,
    emptyDescription,
    setSource,
  ]);

  return null;
}

/** Rendered once, by AppShell, as the column to the right of the main one. */
export function ReceiptPanelColumn() {
  const { source, collapsed, setCollapsed, width, setWidth } = usePanel();
  const t = useTranslations("receipt");
  const widthRef = useRef(width);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState(false);

  const awaitingUpload = isAwaitingUpload(source);
  const open = !collapsed || awaitingUpload;

  // What to do the moment the panel has something to show. Neither of these is
  // persisted — it's the situation deciding, not the reader, and their own
  // preference is waiting untouched for the next page.
  const was = useRef({ source: false, receipt: false, awaiting: false });
  useEffect(() => {
    const now = {
      source: Boolean(source),
      receipt: Boolean(source?.src),
      awaiting: awaitingUpload,
    };
    const appeared = now.source && !was.current.source;
    const receiptArrived = now.receipt && !was.current.receipt;

    if (window.matchMedia("(max-width: 767px)").matches) {
      // On a phone the panel is the whole screen, so it may only be open while
      // it's being *used* — waiting for an upload. Otherwise it folds to the
      // tab as soon as it appears, or as soon as a receipt lands in it.
      if ((appeared && !now.awaiting) || receiptArrived) setCollapsed(true, false);
    } else if (receiptArrived && was.current.awaiting) {
      // On a wide screen one you just uploaded stays up. The panel was open for
      // you to put it there; folding it the instant it lands is not what a
      // stored "collapsed" ever meant.
      setCollapsed(false, false);
    }
    was.current = now;
  }, [source, awaitingUpload, setCollapsed]);

  // The overlay below md covers the whole screen, so the page behind it must
  // not scroll under the finger.
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

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    // The pointer will leave this 12px strip on the first move; capture keeps
    // the events coming to it instead of to whatever it passes over.
    e.currentTarget.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = widthRef.current;
    setDragging(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    // Dragging left widens it, hence the reversed delta.
    const onMove = (ev: PointerEvent) => {
      const max = Math.max(MIN_WIDTH, window.innerWidth * MAX_FRACTION);
      const next = Math.min(max, Math.max(MIN_WIDTH, startWidth + (startX - ev.clientX)));
      widthRef.current = next;
      setWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setDragging(false);
      writeCookie(RECEIPT_WIDTH_COOKIE, String(Math.round(widthRef.current)));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (!source) return null;

  const upload = source.upload;
  const pick = () => fileInput.current?.click();
  const take = (file: File | undefined) => {
    if (file && upload && !upload.uploading) upload.onFile(file);
  };

  // No header, no title: a receipt is recognisably a receipt, and a bar naming
  // it would cost 48px of the height it came here for. The controls it needs
  // float in the corner the viewer's own toolbar doesn't use, styled to match
  // it so the two read as one set of tools.
  const controls = (
    <div className="absolute left-2 top-2 z-20 flex items-center gap-1.5">
      {!awaitingUpload && (
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title={t("collapse")}
          aria-label={t("collapse")}
          aria-expanded
          className={FLOATING_BTN}
        >
          {/* Sideways out of the frame on a wide screen; closed outright on a
              narrow one, where it was covering the page. */}
          <IconChevronRight className="hidden size-4 md:block" />
          <IconX className="size-4 md:hidden" />
        </button>
      )}
      {upload && source.src && (
        <button
          type="button"
          onClick={pick}
          disabled={upload.uploading}
          title={t("replace")}
          aria-label={t("replace")}
          className={cn(FLOATING_BTN, "disabled:opacity-40")}
        >
          {upload.uploading ? <Spinner size="sm" /> : <IconUpload className="size-4" />}
        </button>
      )}
    </div>
  );

  const body = source.src ? (
    <ReceiptViewer
      src={source.src}
      mimeType={source.mimeType}
      filename={source.filename}
      className="min-h-0 flex-1"
    />
  ) : !upload ? (
    // Nothing to show and nowhere to put one: the panel stays and says so,
    // rather than vanishing and letting the page reflow around its absence.
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center text-muted">
      <IconReceipt className="size-8" />
      <p className="mt-3 text-sm font-medium text-foreground">{source.empty?.title}</p>
      {source.empty?.description && (
        <p className="mt-1 max-w-[22rem] text-xs">{source.empty.description}</p>
      )}
    </div>
  ) : (
    // The empty panel *is* the dropzone. It fills the panel rather than sitting
    // in it as a box: the whole column is the target, which is what someone
    // dragging a photo across the screen is aiming at anyway.
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files?.[0]);
      }}
      className={cn(
        "flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center transition-colors",
        over && "bg-accent-soft/40",
      )}
    >
      {upload?.uploading ? (
        // The same tile the dropzone rests in, with the arrow swapped for the
        // spinner — so starting an upload reads as this one thing getting to
        // work, rather than a differently-coloured object appearing in its
        // place. It used to be a brand-filled tile on `animate-pulse`, which
        // flashed without turning: motion that says "look here" rather than
        // "still going", and reduced-motion stopped it dead.
        <div role="status" className="flex flex-col items-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <Spinner size="lg" />
          </span>
          <p className="mt-4 text-sm font-medium">{t("uploading")}</p>
          <p className="mt-1 text-xs text-muted">{t("uploadingHint")}</p>
        </div>
      ) : (
        <>
          <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <IconUpload className="size-6" />
          </span>
          {/* Dragging is a desktop idea; on a phone the button is the whole
              interaction, so the wording changes with the screen. */}
          <p className="mt-4 hidden text-sm font-medium md:block">{t("dropzone")}</p>
          <p className="mt-4 text-sm font-medium md:hidden">{t("pickReceiptLead")}</p>
          <p className="mt-1 text-xs text-muted">{t("fileTypes")}</p>
          <Button className="mt-5" onClick={pick}>
            <IconUpload className="size-4" />
            {t("pickReceipt")}
          </Button>
        </>
      )}
    </div>
  );

  const viewer = (
    <>
      {controls}
      {body}
      {upload && (
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
          className="hidden"
          onChange={(e) => {
            take(e.target.files?.[0]);
            e.target.value = ""; // allow re-selecting the same file
          }}
        />
      )}
    </>
  );

  // Folded, it reserves no width at all — the page gets the whole frame, and
  // the way back is a tab on the edge of the screen. Fixed rather than a column
  // in the flex row, so nothing has to be given up to keep it reachable; the
  // same element at every width, since it was already the right answer on a
  // phone.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        title={t("expand")}
        aria-label={t("expand")}
        aria-expanded={false}
        className="fixed right-0 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-1 rounded-l-xl border border-r-0 border-border bg-background px-1.5 py-3 text-muted shadow-[var(--shadow-card)] transition-colors hover:bg-surface hover:text-foreground print:hidden"
      >
        <IconChevronLeft className="size-4 shrink-0" />
        <IconReceipt className="size-4 shrink-0" />
      </button>
    );
  }

  // Open, it's one element in both layouts, not one per breakpoint: two would
  // both mount, and each would load and parse the receipt for itself.
  return (
    <aside
      style={{ "--receipt-w": `${width}px` } as React.CSSProperties}
      className={cn(
        // Below md it covers the screen; from md it's a column in the frame.
        // md:relative, not md:static: the drag handle and the fold button are
        // positioned against this panel, and `static` would hand them to
        // whatever ancestor happened to be positioned instead — which put the
        // handle somewhere off the panel entirely, with nothing to grab.
        "fixed inset-0 z-40 flex flex-col bg-background print:hidden",
        "md:relative md:z-auto md:h-screen md:w-[var(--receipt-w)] md:max-w-[70vw] md:shrink-0 md:border-l md:border-border",
      )}
    >
      {/* The drag handle is the border itself, widened to something a pointer
          can actually catch, and it only shows what it is on hover — a
          permanent stripe down the middle of the screen would read as a
          divider between two apps rather than something to pull. It sits fully
          inside the panel: half of it hanging over the edge would be clipped
          by the shell's own overflow, leaving half the target it looks like. */}
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
  );
}
