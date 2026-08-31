import Link from "next/link";
import { cn } from "@/lib/ui/utils";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "ghost" | "accentOutline" | "danger" | "dangerOutline";
type Size = "sm" | "md" | "lg";

// The section's pink, flat and unmodified, with a near-black label. The same
// button in both themes, and the only thing on a screen allowed to wear it.
// `.brand-fill` is the section's two colours meeting: pink running to violet.
// It marks the action register; purple on its own still means the authority
// chain. See the note above `.brand-fill` in globals.css.
//
// The hairline is not decoration. The ramp's pink end is 2.5:1 on white, under
// the 3:1 a control owes for its own boundary, so in light the edge draws the
// shape the fill cannot; in dark the token collapses to the fill and it
// disappears.
const VARIANTS: Record<Variant, string> = {
  primary:
    "brand-fill text-on-brand border border-brand-edge shadow-[var(--shadow-card)] active:scale-[0.98]",
  secondary:
    "bg-background text-foreground border border-border hover:bg-surface active:scale-[0.98]",
  ghost: "text-accent hover:bg-accent-soft",
  // The section's pink as an edge rather than a fill: a create button that sits
  // in a toolbar beside a search box, where a filled one is the loudest thing on
  // a page whose subject is the list under it. Same shape as the dashed "add"
  // controls in Inställningar, one step firmer.
  //
  // `accent` and not `brand`, for the reason the hairline above exists: the
  // brand pink is 2.5:1 on white and a border owes 3:1, so the fill's colour
  // cannot draw its own boundary. Accent is the pink that can. It is the one
  // this app already writes text and links in.
  accentOutline:
    "bg-background text-accent border border-accent hover:bg-accent-soft active:scale-[0.98]",
  danger:
    "bg-danger text-on-danger hover:bg-danger-hover active:scale-[0.98]",
  // Destructive but not the primary path: sign out, delete an utlägg.
  dangerOutline:
    "bg-background text-danger border border-border hover:bg-danger-soft hover:border-danger",
};

// "md" is the button a page's actions are drawn at, and like the compact
// control register (CONTROL_SIZES in ui/field.tsx) it stands taller on a phone:
// 40px is a comfortable pointer target and four short of a thumb's.
//
// "sm" is left alone. It is the button that sits inside a table row or beside a
// field, where it is measured against what it stands next to rather than
// against a finger, and growing it would push those rows apart.
const SIZES: Record<Size, string> = {
  sm: "h-8 px-3.5 text-[13px]",
  md: "h-11 px-5 text-sm sm:h-10",
  lg: "h-12 px-7 text-base",
};

// The dimming is applied per-render rather than living here, because a busy
// button is disabled but must not fade: at 40% its spinner is a rumour. cn()
// only concatenates, so an override class would be settled by Tailwind's
// emission order instead of by intent, hence one or the other, never both.
const BASE =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-150 ease-[var(--ease-out-quint)] disabled:pointer-events-none whitespace-nowrap";
const DIMMED = "disabled:opacity-40";

type CommonProps = {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
};

// The spinner sits in the same grid cell as the label rather than beside it, so
// a button that goes busy keeps the width it had. Inline would have been
// simpler, but these buttons sit in toolbars and table rows where a 22px jog
// pushes everything after them sideways, and the row you were about to click
// moving out from under you is worse than losing the word for a second.
//
// The label stays in the layout (`invisible`, not `hidden`) and out of the
// accessibility tree; `aria-busy` is what says what's going on.
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
    /** A request this button started is still in flight. Also disables it. */
    loading?: boolean;
    // Declared because ButtonHTMLAttributes doesn't carry it; React 19 passes a
    // function component's ref through props, so the spread below is enough.
    ref?: React.Ref<HTMLButtonElement>;
  }) {
  return (
    <button
      className={cn(BASE, !loading && DIMMED, VARIANTS[variant], SIZES[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
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
}: CommonProps & { href: string }) {
  return (
    <Link
      href={href}
      className={cn(BASE, DIMMED, VARIANTS[variant], SIZES[size], className)}
    >
      {children}
    </Link>
  );
}
