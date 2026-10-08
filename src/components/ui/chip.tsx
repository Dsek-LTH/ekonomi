"use client";

import { cn } from "@/lib/ui/utils";
import { Spinner } from "./spinner";

// A small toggle chip, used for role, ownership and prefix assignment.
export function Chip({
  active,
  disabled,
  loading = false,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  /**
   * This chip's own toggle is in flight. Every chip in a group shares one busy
   * scope, so pass it only for the one that was clicked. A whole row of
   * spinners says the app is granting five roles, not one.
   */
  loading?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-pressed={active}
      aria-busy={loading || undefined}
      className={cn(
        "h-7 rounded-control border px-3 text-xs font-medium transition-colors",
        loading ? "opacity-100" : "disabled:opacity-50",
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-border bg-background text-muted hover:text-foreground",
      )}
    >
      {/* Stacked, not prepended: these sit in a wrapping row, and a chip that
          widens mid-request reflows every chip after it. */}
      {loading ? (
        <span className="grid place-items-center">
          <span className="invisible col-start-1 row-start-1">{children}</span>
          <Spinner size="sm" className="col-start-1 row-start-1" />
        </span>
      ) : (
        children
      )}
    </button>
  );
}
