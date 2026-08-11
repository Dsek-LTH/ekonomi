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

import { Card } from "./card";
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    // Below md the document is what scrolls, so the page would drift behind the
    // dialog without this.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    // Clicking away closes. That is a mouse affordance with a keyboard
    // equivalent already — Escape, above — so the rules asking for a key
    // handler here are asking for a second copy of one that exists somewhere it
    // works better.
    //
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <Card
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        // Full width and flush to the bottom on a phone, a centred box above it
        // — and never taller than the viewport, because the body scrolls inside
        // rather than the dialog running off the screen.
        className={cn("flex max-h-[92vh] w-full flex-col overflow-hidden", className)}
      >
        {children}
      </Card>
    </div>
  );
}

/** The title strip every dialog opens with: a heading and a line under it. */
export function ModalHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="border-b border-border px-inset py-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
    </div>
  );
}

/** The scrolling middle. Everything a dialog collects goes in here. */
export function ModalBody({ children }: { children: React.ReactNode }) {
  return <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-inset py-4">{children}</div>;
}

/** The strip along the bottom: what is being done on the left, the buttons on
 *  the right. */
export function ModalFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-inset py-4">
      {children}
    </div>
  );
}
