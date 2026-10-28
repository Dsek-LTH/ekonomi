import Link from "next/link";
import { cn } from "@/lib/ui/utils";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "ghost" | "quiet" | "accentOutline" | "danger" | "dangerOutline";
type Size = "sm" | "md" | "lg";

// The section's pink, flat and unmodified, with a white label. The same button
// in both themes, and the only thing on a screen allowed to wear it. It marks
// the action register.
//
// The white is a chosen deviation, not an accident: it measures 3.31:1 in light
// and 2.83 in dark, under the 4.5 a label owes, and the brand block in
// globals.css carries the alternative and the numbers behind it. What it asks of
// this file is that the label stays short and the button stays large, which is
// what `md` and `lg` are for. Nothing small or long goes on the pink.
//
// The hairline is not decoration, though the number behind it has moved. The
// screen pink is 3.31:1 on white, which does clear the 3:1 a control owes for
// its own boundary; the print pink (#f280a1, globals.css under Print) is 2.51
// and does not, and a button on a white card wants a drawn edge either way. In
// dark the token collapses to the fill and the edge disappears, which is the
// right answer there: the fill is already 6:1 against the card.
const VARIANTS: Record<Variant, string> = {
  primary:
    "brand-fill text-on-brand border border-brand-edge shadow-[var(--shadow-card)] active:scale-[0.98]",
  secondary:
    "bg-background text-foreground border border-border hover:bg-hover active:scale-[0.98]",
  ghost: "text-accent hover:bg-accent-soft",
  // No edge and no colour of its own: a control in the header's row, which
  // reads as part of the bar until it is hovered.
  quiet: "text-foreground hover:bg-hover",
  // The section's pink as an edge rather than a fill: a create button that sits
  // in a toolbar beside a search box, where a filled one is the loudest thing on
  // a page whose subject is the list under it. Same shape as the dashed "add"
  // controls in Inställningar, one step firmer.
  //
  // `accent` and not `brand`: a border owes 3:1, the brand pink clears it by a
  // hair at 3.31:1 and the print pink does not clear it at all, and a boundary
  // that is only just enough on one substrate is not a boundary. Accent is the
  // pink that has room, at 5.01:1. It is the one this app already writes text
  // and links in.
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
// 44px for a thumb, and 36px from sm up, level with the filter bar's fields.
//
// "sm" is left alone. It is the button that sits inside a table row or beside a
// field, where it is measured against what it stands next to rather than
// against a finger, and growing it would push those rows apart.
const SIZES: Record<Size, string> = {
  sm: "h-8 px-3.5 text-[13px]",
  md: "h-11 px-4 text-sm sm:h-9",
  lg: "h-11 px-6 text-base sm:h-10",
};

// The dimming is applied per-render rather than living here, because a busy
// button is disabled but must not fade: at 40% its spinner is a rumour. cn()
// only concatenates, so an override class would be settled by Tailwind's
// emission order instead of by intent, hence one or the other, never both.
const BASE =
  "inline-flex items-center justify-center gap-2 rounded-control font-medium transition-all duration-150 ease-[var(--ease-out-quint)] disabled:pointer-events-none whitespace-nowrap";
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
      // Firefox restores a button's disabled state when a page is reloaded or
      // come back to, and it does it to the fresh HTML before React hydrates.
      // A button that was enabled last time (Exportera, before the Fortnox
      // login ran out) then comes back enabled whatever the server said, React
      // reports a hydration mismatch, and it does not patch the attribute, so
      // the button stays clickable. Off means the server's answer stands.
      // Spread because React's types only list autoComplete on fields, though
      // browsers read it on a button too.
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
  /** Replace the current history entry rather than adding one. */
  replace?: boolean;
}) {
  return (
    <Link
      href={href}
      replace={replace}
      className={cn(BASE, DIMMED, VARIANTS[variant], SIZES[size], className)}
    >
      {children}
    </Link>
  );
}
