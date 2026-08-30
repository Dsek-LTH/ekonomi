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
import { ReceiptViewer, type ViewerDocument } from "@/components/receipt/receipt-viewer";
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

/**
 * How long the fold takes, both ways. The same number as `--receipt-fold-ms` in
 * globals.css, which draws the motion; this side only has to keep the panel
 * mounted for exactly as long as it is moving.
 */
const RECEIPT_FOLD_MS = 240;

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
   * What there is to read, in reading order — most often the utläggsräkning
   * and the underlag behind it, sometimes just a receipt the page is still
   * holding in the browser (the wizard keeps the picked file there until the
   * utlägg is saved). The panel doesn't care which: showing a receipt is
   * showing whatever is at these addresses, and "is there one" is this being
   * non-empty.
   */
  docs: ViewerDocument[];
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

/**
 * A page waiting for a receipt keeps the panel open — there'd be nothing to
 * fold away, and folding is how you'd lose the only way to add one.
 *
 * From md, where the panel is a column beside the form. Below it the panel is
 * the whole screen, and "keeps it open" turned into "cannot be left": a new
 * utlägg on a phone opened onto a full-screen dropzone with no close button,
 * with the form it belongs to behind it and no way through. The reasoning above
 * does not hold there either — the folded tab is still on the edge of the
 * screen, so the way to add one is a tap away rather than lost. See `open` and
 * `controls` in ReceiptPanelColumn.
 */
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
 * Declares what the panel should be showing while this page is mounted.
 * Renders nothing. Nothing to show takes the panel away entirely, rather than
 * leaving the last page's receipt standing — unless `onFile` is given, in which
 * case an empty panel is an invitation to upload one.
 *
 * A page gives either a list of `documents` — an utlägg has two, its
 * utläggsräkning and the underlag behind it, and the panel pages between them —
 * or the single-document shorthands: `previewUrl` (one the page is still
 * holding), `documentUrl` (an address the page knows), `receiptId` (a receipt
 * in the archive, whose address is this component's to build), in the order
 * they win. `documents` wins over all of them.
 */
export function ReceiptPanelSource({
  documents,
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
  /**
   * Everything to read, in reading order. An empty list is "there is nothing",
   * exactly as a null `documentUrl` is — so a page can hand this straight from
   * whatever computes it without narrowing first.
   */
  documents?: ViewerDocument[];
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
  /** Describes whichever of the shorthands above was given. */
  mimeType?: string;
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

  const shorthand = previewUrl ?? documentUrl ?? (receiptId ? `/api/receipts/${receiptId}` : null);
  const docs: ViewerDocument[] =
    documents ??
    (shorthand ? [{ src: shorthand, mimeType: mimeType ?? "application/pdf", filename }] : []);

  // The list is compared by value, not by identity: a page that builds it
  // inline builds a new array every render, and registering the source on each
  // one would set state in the provider forever. The effect below reads the
  // current list through a ref — kept fresh by this one, which runs first —
  // and only the string decides whether it runs at all.
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
      upload: accepts ? { onFile: stableOnFile, uploading } : undefined,
      empty: emptyTitle ? { title: emptyTitle, description: emptyDescription } : undefined,
    });
    return () => setSource(null);
  }, [docsKey, accepts, uploading, stableOnFile, emptyTitle, emptyDescription, setSource]);

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

  // The fold, which is a piece of motion rather than a piece of state:
  // `leaving` keeps the panel on screen for as long as it takes to slide off
  // the edge, `entering` runs the same move backwards when it comes back, and
  // `arriving` lets the tab it uncovers say, once, that it is where the receipt
  // went. See the notes by @keyframes receipt-tab-in and receipt-panel-in.
  //
  // All three are set by the buttons rather than by watching `collapsed`,
  // because only some folds are the reader's. A phone folds the panel by itself
  // the moment a page brings one (see the effect below), and a wide screen
  // opens it again when an upload lands; animating either would be an answer to
  // a question nobody asked, on every page load.
  const [leaving, setLeaving] = useState(false);
  const [entering, setEntering] = useState(false);
  const [arriving, setArriving] = useState(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Below md the panel is an overlay over the whole screen rather than a column
  // beside the page, which changes what "open" is allowed to mean.
  const narrow = usePhone();
  const awaitingUpload = isAwaitingUpload(source);
  const open = !collapsed || (awaitingUpload && !narrow);

  // What to do the moment the panel has something to show. Neither of these is
  // persisted — it's the situation deciding, not the reader, and their own
  // preference is waiting untouched for the next page.
  const was = useRef({ source: false, receipt: false, awaiting: false });
  useEffect(() => {
    const now = {
      source: Boolean(source),
      receipt: Boolean(source && source.docs.length > 0),
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

  // Let the panel go, one painted frame after it mounted at the edge.
  //
  // Two frames, not one: a single rAF can still be coalesced into the commit
  // that mounted the panel, and a browser that has never painted the starting
  // value has nothing to transition from — which is the bug this whole dance is
  // about. The second frame guarantees the first has been seen.
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

  // The drag does not go through React at all.
  //
  // It used to call `setWidth` on every pointermove, and `width` lives in the
  // provider at the root of the app — so a single sweep of the handle was a
  // hundred-odd context updates, each re-rendering every consumer, and the
  // viewer's TransformWrapper re-measuring its subtree (getComponentsSizes,
  // which reads layout) each time. Measured at ~5.4ms of main thread per
  // pointermove, which a 120Hz trackpad turns into more work than there is
  // time to do it in, and the drag stuttered.
  //
  // The width is one CSS custom property, and the panel is one element that is
  // already carrying it. So the move handler writes that property directly and
  // React is told once, on release. Nothing re-renders mid-drag; the browser
  // does the one thing it cannot avoid — lay the column out — and does it once
  // per frame rather than once per event.
  const panelRef = useRef<HTMLElement>(null);
  const frame = useRef(0);
  const pending = useRef(0);

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

    // Coalesced to one write per frame. Pointer events arrive faster than
    // frames on any modern trackpad, and every width between two paints is a
    // width nobody sees.
    const paint = () => {
      frame.current = 0;
      widthRef.current = pending.current;
      panelRef.current?.style.setProperty("--receipt-w", `${pending.current}px`);
    };

    // Dragging left widens it, hence the reversed delta.
    const onMove = (ev: PointerEvent) => {
      const max = Math.max(MIN_WIDTH, window.innerWidth * MAX_FRACTION);
      pending.current = Math.min(max, Math.max(MIN_WIDTH, startWidth + (startX - ev.clientX)));
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
      // Now, and only now, does React hear about it: one render, one cookie,
      // and the inline style it renders agrees with what the drag was writing.
      setWidth(final);
      setDragging(false);
      writeCookie(RECEIPT_WIDTH_COOKIE, String(Math.round(final)));
    };
    pending.current = startWidth;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (!source) return null;

  const upload = source.upload;
  const pick = () => fileInput.current?.click();

  // Folding is the reader's, so it gets the motion: the panel leaves toward the
  // edge, and the tab it uncovers marks itself once.
  const foldAway = () => {
    // Whichever way it was already going, it is going this way now. An enter
    // animation still running would otherwise hold the panel at its resting
    // place — a keyframe beats a transition — and it would vanish at the end of
    // the fold instead of sliding out of it.
    setEntering(false);
    setLeaving(true);
    setArriving(true);
    setCollapsed(true);
    timers.current.push(
      window.setTimeout(() => setLeaving(false), RECEIPT_FOLD_MS),
      window.setTimeout(() => setArriving(false), 1100),
    );
  };

  // And back, through the same transition the fold uses rather than an
  // animation of its own.
  //
  // The panel would otherwise mount at its resting place, where a transition
  // has no previous value to move from and nothing happens at all — it simply
  // appears. So it mounts held at the edge instead, `entering` keeping it
  // there, and is let go on the next frame: from there it is the identical
  // move the fold makes, played the other way.
  //
  // `entering` is dropped by the effect below and not on a timer, because what
  // has to happen first is a *paint* — a frame in which the browser has seen
  // the panel at the edge. A timeout races that; two frames cannot.
  const unfold = () => {
    setLeaving(false);
    setEntering(true);
    setCollapsed(false);
  };
  const take = (file: File | undefined) => {
    if (file && upload && !upload.uploading) upload.onFile(file);
  };

  // No header, no title: a receipt is recognisably a receipt, and a bar naming
  // it would cost 48px of the height it came here for. The controls it needs
  // float in the corner the viewer's own toolbar doesn't use, styled to match
  // it so the two read as one set of tools.
  const controls = (
    <div className="absolute left-2 top-2 z-20 flex items-center gap-1.5">
      {/* On a phone this is drawn even while a receipt is still wanted. From md
          it is not: there the panel is a column beside the form, so an open one
          costs nothing and folding it away would only hide the dropzone the
          page is asking you to use. Over the whole screen that same rule is a
          view with no way out. */}
      {(!awaitingUpload || narrow) && (
        <button
          type="button"
          onClick={foldAway}
          title={narrow ? t("close") : t("collapse")}
          aria-label={narrow ? t("close") : t("collapse")}
          aria-expanded
          className={FLOATING_BTN}
        >
          {/* Sideways out of the frame on a wide screen; closed outright on a
              narrow one, where it was covering the page. */}
          <IconChevronRight className="hidden size-4 md:block" />
          <IconX className="size-4 md:hidden" />
        </button>
      )}
      {upload && source.docs.length > 0 && (
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

  const body = source.docs.length > 0 ? (
    <ReceiptViewer documents={source.docs} className="min-h-0 flex-1" />
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
  // the way back is on the edge of the screen. Fixed rather than a column in
  // the flex row, so nothing has to be given up to keep it reachable.
  //
  // It says the word. Two stacked glyphs on a 28px strip in `text-muted` read as
  // a seam in the layout rather than as a control — the chevron only means
  // "something is over there" to someone who already knows what, and on a phone
  // this is the *only* thing anyone ever sees of the receipt, because the panel
  // folds itself away the moment a page brings one. So: the word, and the
  // outlined-accent register the app already uses for a control that must be
  // findable without being the loudest thing on the page (see `accentOutline` in
  // ui/button.tsx — accent rather than brand, because a border owes 3:1 and the
  // brand pink cannot pay it).
  //
  // Which edge, though, is not the same question at both widths. On a wide
  // screen it is the right one, because that is the side the panel opens into
  // and the tab is the panel's own edge showing. A phone has no such side — the
  // panel there is the whole screen — so the right edge is just the middle of
  // the reading column, out of reach of the thumb holding the device and on top
  // of whatever the page put there. The bottom is where a phone keeps the thing
  // you can pull up, so that is where this goes: one element, laid out the way
  // each width wants it rather than one width's answer worn at both.
  const tab = (
    <button
      type="button"
      onClick={unfold}
      title={t("expand")}
      // No aria-label: the tab now says what it is, and a label of "Visa
      // kvittot" over a face reading "Kvitto" is the mismatch WCAG 2.5.3 is
      // about — someone driving this by voice says what they can see. The
      // content names it, aria-expanded says what pressing it does, and the
      // title carries the longer phrasing for a pointer.
      aria-expanded={false}
      className={cn(
        "fixed z-30 flex items-center justify-center gap-2 print:hidden",
        // A phone: a strip across the bottom, in the band a thumb reaches
        // without the hand shifting its grip. The bottom padding clears the
        // home indicator, the same way the phone's nav does
        // (shell/mobile-nav.tsx) — without it the word sits under the bar iOS
        // draws over the foot of the screen.
        "bottom-0 left-0 right-0 rounded-t-2xl px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]",
        // From md: the tab on the right, beside the column it opens into.
        // Every override is same-family on purpose — `cn` joins rather than
        // merges, so `md:bottom-auto` beating `bottom-0` is Tailwind's variant
        // ordering doing it, not luck with `inset-*` against `right-*`.
        "md:bottom-auto md:left-auto md:right-0 md:top-1/2 md:-translate-y-1/2",
        "md:flex-col md:gap-1.5 md:rounded-l-xl md:rounded-tr-none md:px-2.5 md:pb-3.5 md:pt-3.5",
        // The right edge stays borderless at both widths — it is off-screen on
        // a phone and against the frame's edge on a desktop.
        "border-b-0 border-l-0 border-r-0 border-t border-accent md:border-b md:border-l",
        "bg-background text-accent shadow-[var(--shadow-card)] transition-colors hover:bg-accent-soft",
        arriving && "receipt-tab-arriving",
      )}
    >
      <IconReceipt className="size-5 shrink-0 md:size-4" />
      {/* Sideways from md, where the tab is 38px wide and the word is the point
          of it. `writing-mode` and not a rotation: rotating would leave the
          glyphs laid out horizontally in a box the wrong shape, and the parent
          would still be sized for it. */}
      <span className="text-sm font-medium leading-none tracking-wide md:text-[11px] md:[writing-mode:vertical-rl]">
        {t("tab")}
      </span>
      {/* Points the way out of the edge it sits on: up off the bottom of a
          phone, sideways off the right of a desktop. Last in the DOM because
          that is the order the strip reads in — `order-first` puts it back on
          top in the column, where the affordance wants to be above the label
          rather than under it. */}
      {/* One chevron turned, rather than two icons swapped at the breakpoint:
          `rotate-90` on the down-chevron is already how this app writes a
          left-pointing one (shell/app-shell.tsx, the "back to app" link). */}
      <IconChevronDown className="size-4 shrink-0 rotate-180 md:order-first md:rotate-90" />
    </button>
  );

  // Open, it's one element in both layouts, not one per breakpoint: two would
  // both mount, and each would load and parse the receipt for itself.
  //
  // And one element across the fold, too: the aside keeps its place in this
  // tree while it is leaving, so React keeps the instance and the browser has
  // something to interpolate from. Returning the tab *instead of* the panel
  // would mount a new node already sitting off-screen, and there would be no
  // motion at all — only a disappearance, which is the thing being fixed.
  const leavingNow = leaving && !open;

  return (
    <>
      {(open || leavingNow) && (
        <aside
          ref={panelRef}
          aria-hidden={leavingNow || undefined}
          // The drag writes this same property straight onto the node; this is
          // the value it starts from and the value React puts back on release.
          style={{ "--receipt-w": `${width}px` } as React.CSSProperties}
          className={cn(
            // Below md it covers the screen; from md it's a column in the frame.
            "flex flex-col bg-background print:hidden",
            // The motion lives in globals.css beside its own keyframes — the
            // transition that folds it away, the animation that brings it back,
            // and the one duration both are timed to.
            "receipt-panel fixed inset-y-0 left-0 right-0 z-40",
            // Promised while it moves, either way, and taken back after — see
            // .receipt-panel-moving.
            (entering || leavingNow) && "receipt-panel-moving",
            leavingNow
              ? // Out towards whichever edge the tab is on: down off the bottom
                // of a phone, right off the side of a desktop. The panel and
                // the tab are the same object at two sizes, and a panel that
                // left one way to become a tab somewhere else would say they
                // were not.
                //
                // On the way out it is `fixed` at both widths, which is what
                // makes the desktop case cost nothing: out of the flex row, so
                // the main column takes the width back in the same frame the
                // panel starts sliding, and the panel itself moves on the
                // compositor. Shrinking it in place would have been the other
                // reading, but that resizes the viewer 12 times on the way —
                // the exact re-measure the drag above goes to such lengths to
                // avoid. Nothing in here is clickable while it leaves.
                "pointer-events-none translate-y-full md:translate-x-full md:translate-y-0 md:left-auto md:w-[var(--receipt-w)] md:max-w-[70vw] md:border-l md:border-border"
              : // md:relative, not md:static: the drag handle and the fold
                // button are positioned against this panel, and `static` would
                // hand them to whatever ancestor happened to be positioned
                // instead — which put the handle somewhere off the panel
                // entirely, with nothing to grab.
                cn(
                  "md:relative md:inset-auto md:z-auto md:h-screen md:w-[var(--receipt-w)] md:max-w-[70vw] md:shrink-0 md:border-l md:border-border",
                  // In its place in the layout from the first frame — the main
                  // column gives up the width at once — but held out at the
                  // edge until the frame after, so there is something to come
                  // back from.
                  entering && "translate-y-full md:translate-x-full md:translate-y-0",
                ),
          )}
        >
          {/* The drag handle is the border itself, widened to something a
              pointer can actually catch, and it only shows what it is on hover —
              a permanent stripe down the middle of the screen would read as a
              divider between two apps rather than something to pull. It sits
              fully inside the panel: half of it hanging over the edge would be
              clipped by the shell's own overflow, leaving half the target it
              looks like. */}
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
