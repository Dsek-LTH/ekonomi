"use client";

import { cn } from "@/lib/ui/utils";
import { Spinner } from "./spinner";

// The one icon-only button: row actions (delete, rename, close, cancel) across
// the lists, sheets and settings screens. `label` is both the tooltip and the
// accessible name. An icon button always needs both, and they were drifting
// apart when every call site wrote them by hand.
type Tone = "muted" | "danger";

const TONES: Record<Tone, string> = {
  muted: "hover:bg-hover hover:text-foreground",
  danger: "hover:bg-danger/10 hover:text-danger",
};

// Radius belongs to the size: "xs" is the round button that sits inside a pill,
// the other two are square-ish row actions.
const SIZES = {
  xs: "rounded-full p-0.5",
  sm: "rounded-lg p-1",
  md: "rounded-lg p-1.5",
};

export function IconButton({
  label,
  title,
  tone = "muted",
  size = "md",
  reveal,
  loading = false,
  disabled,
  className,
  children,
  ...props
}: {
  label: string;
  tone?: Tone;
  size?: keyof typeof SIZES;
  /** Hidden until the row is hovered or the button is focused (sheet rows). */
  reveal?: boolean;
  /** A request this button started is still in flight. Also disables it. */
  loading?: boolean;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      // `title ?? label`, not a plain override: a call site that passes a
      // conditional tooltip (`cond ? hint : undefined`) would otherwise spread
      // `undefined` over the fallback and lose the tooltip entirely.
      title={title ?? label}
      aria-label={label}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "shrink-0 text-muted transition disabled:pointer-events-none",
        // Busy is not the same as unavailable: fading a spinner to 40% is how
        // you end up with a button that looks broken rather than working.
        loading ? "opacity-100" : "disabled:opacity-40",
        SIZES[size],
        TONES[tone],
        // A revealed action that is mid-request has to stay visible even after
        // the pointer leaves the row it belongs to.
        reveal && !loading && "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
        className,
      )}
      {...props}
    >
      {/* Stacked on the icon rather than swapped for it. Call sites size their
          own glyph (16px in a sheet row, 20px in a header), and the button has
          no padding to spare, so the hidden icon is what holds the box open. */}
      {loading ? (
        <span className="grid place-items-center">
          <span className="invisible col-start-1 row-start-1">{children}</span>
          <Spinner size="sm" className="col-start-1 row-start-1 text-accent" />
        </span>
      ) : (
        children
      )}
    </button>
  );
}
