import { IconAlert, IconInfo } from "./icons";
import { cn } from "@/lib/ui/utils";

// A condition that stays true until fixed, unlike a notification (components/shell/notifications.tsx).
type NoticeTone = "warning" | "danger" | "info";

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
  children: React.ReactNode;
}) {
  const { box, icon } = TONE[tone];
  return (
    // role="status": announced without taking focus; an alert would be too much.
    <div
      role="status"
      className={cn(
        "flex items-center gap-3 rounded-panel border px-4 py-3 text-sm text-foreground",
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
