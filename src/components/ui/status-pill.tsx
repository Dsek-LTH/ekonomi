import { useTranslations } from "next-intl";
import { STATUS_TONE, TONE_CLASSES } from "@/lib/domain/status";
import type { ExpenseStatus } from "@/lib/domain/types";
import { cn } from "@/lib/ui/utils";

export function StatusPill({ status, className }: { status: ExpenseStatus; className?: string }) {
  const t = useTranslations("common.status");
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-control px-1.5 py-0.5 text-xs font-medium",
        TONE_CLASSES[STATUS_TONE[status]],
        className,
      )}
    >
      {t(status)}
    </span>
  );
}

// A neutral label by default; `tone` gives it StatusPill's colours.
export function Tag({
  children,
  tone = "neutral",
  size = "md",
  title,
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof TONE_CLASSES;
  size?: "sm" | "md";
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-control font-medium",
        size === "sm" ? "px-1.5 py-px text-[11px]" : "px-1.5 py-0.5 text-xs",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
