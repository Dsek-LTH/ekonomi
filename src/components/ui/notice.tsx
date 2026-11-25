import { IconAlert, IconInfo } from "./icons";
import { cn } from "@/lib/ui/utils";

// Where a warning goes depends on what it is about (docs/layout.md):
// - one field or value: `Issue` right under it (or a Field's `error`);
// - the next step: `Issues` beside the page's main button, a blocker as the button's disabled reason;
// - the whole page (changed elsewhere, not set up, sent back): `Notice`, one slim line at the top.
// None of them is a filled box. Danger and warning differ in colour only, never in shape.

type NoticeTone = "warning" | "danger" | "info";

const BAR: Record<Exclude<NoticeTone, "info">, { bar: string; icon: string }> = {
  warning: { bar: "border-warning", icon: "text-warning" },
  danger: { bar: "border-danger", icon: "text-danger" },
};

/**
 * A condition of the whole page that stays true until fixed, unlike a notification (components/shell/notifications.tsx).
 * Warning and danger are a coloured bar on the left with the text in the normal colour. Information is muted text
 * with no bar: it is not something to act on.
 */
export function Notice({
  tone = "warning",
  className,
  children,
}: {
  tone?: NoticeTone;
  className?: string;
  children: React.ReactNode;
}) {
  if (tone === "info") {
    return (
      <div role="status" className={cn("flex items-start gap-2 text-sm text-muted", className)}>
        <IconInfo className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 space-y-1">{children}</div>
      </div>
    );
  }
  const { bar, icon } = BAR[tone];
  return (
    // role="status": announced without taking focus; an alert would be too much.
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 border-l-2 py-0.5 pl-3 text-sm text-foreground",
        bar,
        className,
      )}
    >
      <IconAlert className={cn("mt-0.5 size-4 shrink-0", icon)} />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

export interface IssueItem {
  key: string;
  text: React.ReactNode;
  tone?: "warning" | "danger";
}

/** One warning about the value right above it: small coloured text, no box. */
export function Issue({
  tone = "warning",
  className,
  children,
}: {
  tone?: "warning" | "danger";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-xs",
        tone === "danger" ? "text-danger" : "text-warning",
        className,
      )}
    >
      <IconAlert className="mt-px size-3.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** What is worth a look before the page's main action, set beside its button. Nothing when there is nothing. */
export function Issues({ items, className }: { items: IssueItem[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <div role="status" className={cn("min-w-0 space-y-0.5", className)}>
      {items.map((i) => (
        <Issue key={i.key} tone={i.tone}>
          {i.text}
        </Issue>
      ))}
    </div>
  );
}
