import { useTranslations } from "next-intl";
import { STATUS_TONE, TONE_CLASSES } from "@/lib/domain/status";
import type { ExpenseStatus } from "@/lib/domain/types";
import { cn } from "@/lib/ui/utils";

export function StatusPill({
  status,
  className,
}: {
  status: ExpenseStatus;
  className?: string;
}) {
  const t = useTranslations("common.status");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        TONE_CLASSES[STATUS_TONE[status]],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {t(status)}
    </span>
  );
}

// A neutral label by default; `tone` gives it the same colour language as
// StatusPill for the few places that label a state rather than a value.
export function Tag({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof TONE_CLASSES;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
