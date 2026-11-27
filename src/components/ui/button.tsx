import Link from "next/link";
import { cn } from "@/lib/ui/utils";
import { Spinner } from "./spinner";

type Variant =
  "primary" | "secondary" | "soft" | "ghost" | "quiet" | "danger" | "dangerOutline" | "link";
type Size = "xs" | "sm" | "md" | "lg";

/**
 * The pink hue: the third of the three colours a button may have (full pink, white, this). The sidebar's current
 * page wears it too. Also for anything chosen that is drawn by hand (a segment, a choice card), so a selected thing
 * is never black.
 */
export const SOFT_FILL = "bg-action-from/15 text-foreground";
export const SOFT_HOVER = "hover:bg-action-from/25";
/** A text-only button's hover: a faint pink hue, so not even a hover turns a button grey. */
export const TEXT_HOVER = "hover:bg-action-from/10";

// A button is full pink (primary, .action-fill in globals.css), white (secondary) or the pink hue (soft). Ghost and
// quiet are text, with the faint hue on hover. Danger is red, which is a warning and not a fourth colour.
// The pink's label is ink (`on-action`): white on the brand pink is 2.5:1, ink is 7.1:1.
const VARIANTS: Record<Variant, string> = {
  primary: "action-fill text-on-action border active:scale-[0.98]",
  // On a dark ground a white button is a lighter grey block (the hover grey), outline kept, so it holds its own beside a
  // pink one. Hover lifts it one step more. Light stays white.
  secondary:
    "bg-background dark:bg-hover text-foreground border border-border-control hover:bg-hover dark:hover:bg-[color-mix(in_srgb,var(--color-hover),white_7%)] active:scale-[0.98]",
  soft: `${SOFT_FILL} ${SOFT_HOVER} active:scale-[0.98]`,
  ghost: `text-foreground ${TEXT_HOVER}`,
  quiet: `text-foreground ${TEXT_HOVER}`,
  danger: "bg-danger text-on-danger hover:bg-danger-hover active:scale-[0.98]",
  dangerOutline:
    "bg-background dark:bg-hover text-danger border border-border-control hover:bg-danger-soft dark:hover:bg-danger-soft hover:border-danger",
  link: "font-medium link disabled:opacity-40",
};

// One height for every control that can sit beside another: 40px on a phone, 32px from sm up, the same as a field
// (CONTROL_SIZES in ui/field.tsx), a menu button and the collection switch. sm and md differ only in padding, so a
// button never comes out shorter than the input next to it. xs is the exception: an action inside a table row,
// where nothing sits beside it and the row's height is the point. Still 32px on a phone, for the thumb.
const SIZES: Record<Size, string> = {
  xs: "h-8 gap-1.5 px-2 text-xs sm:h-6",
  sm: "h-10 px-2.5 text-sm sm:h-8",
  md: "h-10 px-3 text-sm sm:h-8",
  lg: "h-10 px-4 text-sm sm:h-9",
};

// Dimming is applied per render: a busy button is disabled but must not fade. cn() only concatenates, so never both.
const BASE =
  "inline-flex items-center justify-center gap-2 rounded-control font-medium transition-all duration-150 ease-[var(--ease-out-quint)] disabled:pointer-events-none whitespace-nowrap";
const DIMMED = "disabled:opacity-40";
// A disabled pink button is grey, not a paler pink: faded, the brand colour reads as broken rather than unavailable,
// and the label on it was hard to read. Grey with its label in muted ink says "not yet" and stays legible.
const PRIMARY_DISABLED =
  "disabled:bg-none disabled:bg-surface disabled:text-muted disabled:border-border-control";

type CommonProps = {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
};

// The spinner shares the label's grid cell so a busy button keeps its width. The label stays in layout (invisible) and aria-busy says why.
const BUSY_SPINNER: Record<Size, "sm" | "md"> = { xs: "sm", sm: "sm", md: "sm", lg: "md" };

export function Button({
  variant = "primary",
  size = "md",
  className,
  loading = false,
  disabled,
  children,
  ...props
}: CommonProps &
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    loading?: boolean;
    ref?: React.Ref<HTMLButtonElement>;
  }) {
  return (
    <button
      className={cn(
        variant !== "link" &&
          cn(BASE, !loading && (variant === "primary" ? PRIMARY_DISABLED : DIMMED), SIZES[size]),
        VARIANTS[variant],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      // Firefox restores a button's disabled state before hydration, leaving a stale enabled button. Off lets the server's answer stand.
      {...{ autoComplete: "off" }}
      {...props}
    >
      {loading ? (
        <span className="grid place-items-center">
          <span className="invisible col-start-1 row-start-1 flex items-center gap-2">
            {children}
          </span>
          <Spinner size={BUSY_SPINNER[size]} className="col-start-1 row-start-1" />
        </span>
      ) : (
        children
      )}
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  children,
  href,
  replace,
  onClick,
}: CommonProps & {
  href: string;
  replace?: boolean;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
}) {
  return (
    <Link
      href={href}
      replace={replace}
      onClick={onClick}
      className={cn(
        variant !== "link" && cn(BASE, DIMMED, SIZES[size]),
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}
