"use client";

// Scrim that cancels on click, centred card, Escape out, Tab held inside (lib/ui/focus-trap.ts, stacked like Escape), page behind held still.
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { Card } from "./card";
import { IconAlert } from "./icons";
import { useEscape } from "@/lib/ui/escape";
import { useFocusTrap } from "@/lib/ui/focus-trap";
import { cn } from "@/lib/ui/utils";

/** The chrome every dialog needs, without the card: portalled (position: fixed breaks under a transformed ancestor), scrim, Escape, focus trap, scroll lock. Separate from Modal because the confirm dialog wants a different card. */
export function DialogLayer({
  active = true,
  onDismiss,
  className,
  children,
}: {
  active?: boolean;
  onDismiss: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);

  // Escape closes only this layer (lib/ui/escape.ts, lib/ui/focus-trap.ts).
  useEscape(active, onDismiss);
  useFocusTrap(active, boxRef);

  useEffect(() => {
    if (!active) return;
    // Below md the document is what scrolls, so the page would drift behind the dialog.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);

  if (!active || typeof document === "undefined") return null;

  return createPortal(
    // Clicking away is a mouse affordance; Escape is the keyboard equivalent.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className={cn("fixed inset-0 z-[200] bg-black/40", className)} onClick={onDismiss}>
      <div ref={boxRef} className="contents">
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Modal({
  label,
  onClose,
  className,
  /** "large" takes most of the viewport, leaving a margin of scrim. Only Settings needs it. */
  variant = "dialog",
  children,
}: {
  label: string;
  onClose: () => void;
  className?: string;
  variant?: "dialog" | "large";
  children: React.ReactNode;
}) {
  const large = variant === "large";
  return (
    <DialogLayer
      onDismiss={onClose}
      className={large ? undefined : "sm:flex sm:items-center sm:justify-center sm:p-6"}
    >
      <Card
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          large
            ? "fixed inset-3 flex flex-col overflow-hidden sm:inset-8 lg:inset-12"
            : cn(
                // A bottom sheet on a phone, placed by equal insets: 12px or the home indicator, whichever is taller.
                "absolute inset-x-3 mx-auto flex flex-col overflow-hidden",
                "bottom-[max(0.75rem,env(safe-area-inset-bottom))] max-h-[88dvh]",
                // dvh, not vh: on iOS vh is the toolbars-hidden height.
                "sm:static sm:w-full sm:max-h-[92dvh]",
              ),
          className,
        )}
      >
        {children}
      </Card>
    </DialogLayer>
  );
}

export function ModalHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    // shrink-0, here and on the footer: on a short phone a long body would otherwise squash the strips.
    <div className="shrink-0 border-b border-border px-inset py-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
    </div>
  );
}

export function ModalBody({ children }: { children: React.ReactNode }) {
  // overscroll-contain: otherwise reaching the end hands the gesture to the page behind.
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-inset py-4">
      {children}
    </div>
  );
}

export function ModalFooter({
  blocker,
  children,
}: {
  /** Why the dialog's own button is dead, in one sentence, or null. Compute it from the expression that disables the button. */
  blocker?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="shrink-0 border-t border-border px-inset py-4">
      {blocker && (
        // role="status": announced without taking focus. Not a Notice: one line about the button under it.
        <p role="status" className="mb-3 flex items-start gap-2 text-xs text-warning">
          <IconAlert className="mt-px size-3.5 shrink-0" />
          {blocker}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">{children}</div>
    </div>
  );
}
