import Link from "next/link";
import { cn } from "@/lib/ui/utils";
import { Spinner } from "./spinner";

type Variant =
  | "primary"
  | "secondary"
  | "ghost"
  | "quiet"
  | "accentOutline"
  | "danger"
  | "dangerOutline"
  | "link";
type Size = "sm" | "md" | "lg";

// See .action-fill in globals.css.
const VARIANTS: Record<Variant, string> = {
  primary: "action-fill text-white border active:scale-[0.98]",
  secondary:
    "bg-background text-foreground border border-border-control hover:bg-hover active:scale-[0.98]",
  ghost: "text-accent hover:bg-accent-soft",
  quiet: "text-foreground hover:bg-hover",
  accentOutline:
    "bg-background text-accent border border-accent hover:bg-accent-soft active:scale-[0.98]",
  danger: "bg-danger text-on-danger hover:bg-danger-hover active:scale-[0.98]",
  dangerOutline:
    "bg-background text-danger border border-border-control hover:bg-danger-soft hover:border-danger",
  link: "font-medium text-link underline decoration-link/40 underline-offset-2 hover:decoration-current disabled:opacity-40",
};

// md is 44px on a phone and 32px from sm up (CONTROL_SIZES in ui/field.tsx). sm sits in table rows.
const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-11 px-3 text-sm sm:h-8",
  lg: "h-11 px-4 text-sm sm:h-9",
};

// Dimming is applied per render: a busy button is disabled but must not fade. cn() only concatenates, so never both.
const BASE =
  "inline-flex items-center justify-center gap-2 rounded-control font-medium transition-all duration-150 ease-[var(--ease-out-quint)] disabled:pointer-events-none whitespace-nowrap";
const DIMMED = "disabled:opacity-40";

type CommonProps = {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
};

// The spinner shares the label's grid cell so a busy button keeps its width. The label stays in layout (invisible) and aria-busy says why.
const BUSY_SPINNER: Record<Size, "sm" | "md"> = { sm: "sm", md: "sm", lg: "md" };

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
        variant !== "link" && cn(BASE, !loading && DIMMED, SIZES[size]),
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
}: CommonProps & {
  href: string;
  replace?: boolean;
}) {
  return (
    <Link
      href={href}
      replace={replace}
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
