"use client";

// The box a dialog is drawn in: a scrim that cancels when clicked, a card
// centred on it, Escape as the keyboard way out, and the page behind held still
// while it is up.
//
// Extracted when the second income dialog wanted the same four things the first
// one had written out by hand. Not folded into `useConfirm`
// (components/confirm-dialog.tsx): that asks a question and answers yes or no,
// while these collect something — a destination and an account per line, a
// verksamhet and a day — and the difference is the whole body of the dialog.
//
// Deliberately not a focus trap, which the confirm dialog does have. That one
// is summoned mid-action from anywhere in the app and answered with a keypress;
// these are opened from a button, filled in, and submitted, and the trapping
// belongs with the rest of that behaviour if it is ever wanted here too.
import { useEffect } from "react";
import { createPortal } from "react-dom";

import { Card } from "./card";
import { useEscape } from "@/lib/ui/escape";
import { cn } from "@/lib/ui/utils";

export function Modal({
  /** What a screen reader announces on arrival. */
  label,
  onClose,
  /** The card's width, above all — the rest of its shape is set here. */
  className,
  children,
}: {
  label: string;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  // Only when this dialog is the topmost thing open — a menu or a scanner on
  // top of it answers Escape first, and one press should close one thing. See
  // lib/ui/escape.ts.
  useEscape(true, onClose);

  useEffect(() => {
    // Below md the document is what scrolls, so the page would drift behind the
    // dialog without this.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Every dialog in the app is opened by a click, so there is never one in the
  // first render to mismatch — but the guard is what says that out loud rather
  // than leaving the file to throw on a server that has no document.
  if (typeof document === "undefined") return null;

  return createPortal(
    // Portalled to <body> rather than left where it was written. A dialog is
    // the topmost thing on the screen, and `position: fixed` only means "the
    // viewport" while nothing above it in the tree has a transform, a filter or
    // a `contain` — any one of which silently turns the scrim into a box the
    // size of whatever page element grew it, which is how a centred dialog ends
    // up hanging off one edge. Out here it has no ancestors to be caught by.
    //
    // Clicking away closes. That is a mouse affordance with a keyboard
    // equivalent already — Escape, above — so the rules asking for a key
    // handler here are asking for a second copy of one that exists somewhere it
    // works better.
    //
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="fixed inset-0 z-[200] bg-black/40 sm:flex sm:items-center sm:justify-center sm:p-6"
      onClick={onClose}
    >
      <Card
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          // On a phone this is a sheet that comes up from the bottom, and it is
          // placed by its own insets rather than by the scrim's centring: with
          // an equal `left` and `right` there is no arithmetic left to get
          // wrong, and a `max-w-` from the call site is centred inside them by
          // the auto margins (an over-constrained absolute box splits the slack
          // evenly). 12px of it, so the card reads as a card standing on the
          // page rather than as the screen having changed — a rounded corner
          // needs somewhere to be round against.
          //
          // The bottom offset is that same 12px or the home indicator's strip,
          // whichever is taller: on a phone that has one, 12px would put the
          // buttons under it, and on a phone that hasn't, adding the two would
          // leave the sheet floating.
          "absolute inset-x-3 mx-auto flex flex-col overflow-hidden",
          "bottom-[max(0.75rem,env(safe-area-inset-bottom))] max-h-[88dvh]",
          // dvh, not vh: on iOS `vh` is the toolbars-hidden height, so a cap in
          // `vh` lets the dialog run under the toolbar that is actually there.
          //
          // From sm it goes back into the scrim's flow and is centred by it.
          "sm:static sm:w-full sm:max-h-[92dvh]",
          className,
        )}
      >
        {children}
      </Card>
    </div>,
    document.body,
  );
}

/** The title strip every dialog opens with: a heading and a line under it. */
export function ModalHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    // shrink-0, here and on the footer: the card is capped at a fraction of the
    // screen and its parts are flex children, so on a short phone a body too
    // long to fit would otherwise be given room by squashing the strips at
    // either end of it rather than by scrolling.
    <div className="shrink-0 border-b border-border px-inset py-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
    </div>
  );
}

/** The scrolling middle. Everything a dialog collects goes in here. */
export function ModalBody({ children }: { children: React.ReactNode }) {
  // overscroll-contain: on a phone this is the only thing that scrolls, and
  // without it reaching the end of it hands the gesture to the page behind.
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-inset py-4">
      {children}
    </div>
  );
}

/** The strip along the bottom: what is being done on the left, the buttons on
 *  the right. */
export function ModalFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-inset py-4">
      {children}
    </div>
  );
}
