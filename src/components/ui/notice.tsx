import { IconAlert, IconInfo } from "./icons";
import { cn } from "@/lib/ui/utils";

// The app's inline warning: a tinted box with a hairline, an icon, and a
// sentence about the state of the thing you are looking at.
//
// Not a notification. A notification is something that just happened and goes
// away (components/shell/notifications.tsx); this is a condition that is true
// until someone fixes it (an utlägg that cannot be submitted yet, an account
// a voucher points at that is not in the chart) so it sits in the page, next
// to what it is about, for as long as it holds.
//
// It was drawn from scratch in four places before this, each a few pixels
// apart, which is how a design language stops being one.
type NoticeTone = "warning" | "danger" | "info";

// Flat tone, the way status is everywhere else. The gradient belongs to the
// action register (see DESIGN.md), and a notice is not something you do.
const TONE: Record<NoticeTone, { box: string; icon: string }> = {
  warning: { box: "border-warning/30 bg-warning-soft", icon: "text-warning" },
  danger: { box: "border-danger/30 bg-danger-soft", icon: "text-danger" },
  info: { box: "border-border bg-surface", icon: "text-muted" },
};

export function Notice({
  tone = "warning",
  className,
  children,
}: {
  tone?: NoticeTone;
  className?: string;
  /** One line, or several, each its own <p>, stacked. */
  children: React.ReactNode;
}) {
  const { box, icon } = TONE[tone];
  return (
    // role="status": it is announced when it appears, without taking focus or
    // interrupting. An alert would be too much for a condition that is simply
    // true about the page.
    <div
      role="status"
      className={cn(
        // Centred against the text, not aligned to its first line: these are
        // one or two short sentences, so an icon pinned to the top edge reads
        // as hanging off the box rather than labelling what is in it.
        "flex items-center gap-3 rounded-xl border px-4 py-3 text-sm text-foreground",
        box,
        className,
      )}
    >
      {tone === "info" ? (
        <IconInfo className={cn("size-4 shrink-0", icon)} />
      ) : (
        <IconAlert className={cn("size-4 shrink-0", icon)} />
      )}
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}
