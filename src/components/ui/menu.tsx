"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { IconChevronDown } from "@/components/ui/icons";
import { cn } from "@/lib/ui/utils";
import { useEscape } from "@/lib/ui/escape";
import { useDismissOnOutside } from "@/lib/ui/dismiss";
import { placeAnchored, useAnchorRect } from "@/lib/ui/anchored-panel";

const CloseCtx = createContext<() => void>(() => {});

export function Menu({
  label,
  icon,
  variant = "primary",
  size = "md",
  disabled,
  loading = false,
  align = "end",
  compact = false,
  iconOnly = false,
  accessibleName,
  trigger,
  triggerClassName,
  narrow = false,
  holdOpen = false,
  className,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  disabled?: boolean;
  /** Below sm, show the icon alone (label stays the accessible name). */
  compact?: boolean;
  /** The icon alone at every width, for a menu that belongs to a row. */
  iconOnly?: boolean;
  /** Accessible name where the drawn label leans on context ("Räkenskapsår 2026"). */
  accessibleName?: string;
  /** An action picked here is still running: the trigger carries the spinner. */
  loading?: boolean;
  /** Draw this instead of a button, for a trigger that is not an action. `label` stays the accessible name. */
  trigger?: React.ReactNode;
  triggerClassName?: string;
  /** A panel as wide as its items rather than at least 14rem. */
  narrow?: boolean;
  align?: "start" | "end";
  /** Open whatever the reader does, e.g. for a guide; a press outside or Escape closes only what the reader opened. */
  holdOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  // Held in state: the panel is positioned from outside its subtree (lib/ui/anchored-panel.ts).
  const shown = open || holdOpen;
  const [rect, setRect] = useAnchorRect(shown, triggerRef, panelRef, close);

  // Measured in a frame, not the effect, which would render twice.
  useEffect(() => {
    if (!holdOpen) return;
    const frame = requestAnimationFrame(() =>
      setRect(triggerRef.current?.getBoundingClientRect() ?? null),
    );
    return () => cancelAnimationFrame(frame);
  }, [holdOpen, setRect]);

  function toggle() {
    setOpen((o) => {
      if (!o && triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
      return !o;
    });
  }

  // Both boxes count as inside: the panel is portalled. Escape returns focus to the button.
  useDismissOnOutside(open, [boxRef, panelRef], close);

  const WANTED = 220;

  // No `cap`: WANTED is the flip threshold, not a ceiling.
  const panelStyle = () => placeAnchored(rect, { wanted: WANTED, align });

  useEscape(open, () => {
    setOpen(false);
    triggerRef.current?.focus();
  });

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      {trigger ? (
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={shown}
          aria-label={label}
          title={label}
          onClick={toggle}
          className={triggerClassName}
        >
          {trigger}
        </button>
      ) : (
        <Button
          ref={triggerRef}
          variant={variant}
          size={size}
          disabled={disabled}
          loading={loading}
          aria-haspopup="menu"
          aria-expanded={shown}
          aria-label={accessibleName ?? (compact || iconOnly ? label : undefined)}
          title={compact || iconOnly ? label : undefined}
          onClick={toggle}
          // The wrapper decides the width, so a stretched wrapper stretches the trigger.
          className="w-full"
        >
          {icon}
          {!iconOnly && <span className={cn(compact && "hidden sm:inline")}>{label}</span>}
          {!iconOnly && (
            <IconChevronDown
              className={cn(
                "size-4 transition-transform duration-200 ease-[var(--ease-out-quint)]",
                shown && "rotate-180",
                compact && "hidden sm:block",
              )}
            />
          )}
        </Button>
      )}

      {/* Portalled with fixed positioning so overflow ancestors (TableScroll) cannot clip it.
      z-[210] is the combobox's layer: above modals at z-[200], below notifications at z-[220]. */}
      {shown &&
        rect &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label={label}
            // Its own focus layer (lib/ui/focus-trap.ts).
            data-popup-layer=""

            style={panelStyle()}
            className={cn(
              "z-[210] max-h-[min(70vh,26rem)] w-max max-w-[min(22rem,80vw)] overflow-y-auto rounded-panel border border-border bg-background p-1 shadow-[var(--shadow-pop)]",
              narrow ? "min-w-28" : "min-w-56",
            )}
          >
            <CloseCtx.Provider value={close}>{children}</CloseCtx.Provider>
          </div>,
          document.body,
        )}
    </div>
  );
}

export function MenuItem({
  onClick,
  disabled,
  className,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const close = useContext(CloseCtx);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        close();
        onClick();
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-left text-sm transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-border/60" />;
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-muted">{children}</p>;
}

export function MenuNote({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 pb-1.5 pt-1 text-xs leading-snug text-muted">{children}</p>;
}
