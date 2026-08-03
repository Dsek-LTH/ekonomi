"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { IconChevronDown } from "@/components/ui/icons";
import { cn } from "@/lib/ui/utils";

// A button that drops a short list of actions beneath itself. For the case where
// one button is really two or three variants of the same verb — "new budget",
// but empty or copied from one of these — and a form would only be asking a
// question the list can answer directly.
//
// Not a substitute for a form: everything here is one click with no arguments.
// If an action needs typing, it belongs on the page it leads to.
//
//   <Menu label="Ny budget" icon={<IconPlus className="size-4" />}>
//     <MenuItem onClick={createEmpty}>Tom budget 2026</MenuItem>
//   </Menu>

const CloseCtx = createContext<() => void>(() => {});

export function Menu({
  label,
  icon,
  variant = "primary",
  size = "md",
  disabled,
  loading = false,
  align = "end",
  className,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  disabled?: boolean;
  /**
   * An action picked from this menu is still running. The trigger carries the
   * spinner because the item that started it is gone — the menu closes on
   * choosing, so the trigger is the only thing left to say so.
   */
  loading?: boolean;
  /** Which edge the panel lines up with — "end" hangs it left of the button. */
  align?: "start" | "end";
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = () => setOpen(false);

  // Clicking away closes it, and Escape closes it and hands focus back to the
  // button — otherwise a keyboard user is left standing on nothing.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <Button
        ref={triggerRef}
        variant={variant}
        size={size}
        disabled={disabled}
        loading={loading}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        {label}
        <IconChevronDown className={cn("size-4 transition-transform duration-150", open && "rotate-180")} />
      </Button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          className={cn(
            "absolute z-40 mt-1 max-h-[min(70vh,26rem)] w-max min-w-56 max-w-[min(22rem,80vw)] overflow-y-auto rounded-xl border border-border bg-background p-1 shadow-[var(--shadow-pop)]",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          <CloseCtx.Provider value={close}>{children}</CloseCtx.Provider>
        </div>
      )}
    </div>
  );
}

// Choosing an item closes the menu — every item here is a complete action, so
// there is never a reason to stay.
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
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface disabled:pointer-events-none disabled:opacity-40",
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
  return <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">{children}</p>;
}

/** A closing line of small print — what the actions above will actually do. */
export function MenuNote({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 pb-1.5 pt-1 text-[11px] leading-snug text-muted">{children}</p>;
}
