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
        // No dot: the tint already says which state, and a dot inside it said
        // it a second time. The word says it a third, and is the one that counts.
        "inline-flex items-center whitespace-nowrap rounded-control px-1.5 py-0.5 text-xs font-medium",
        TONE_CLASSES[STATUS_TONE[status]],
        className,
      )}
    >
      {t(status)}
    </span>
  );
}

// A neutral label by default; `tone` gives it the same colour language as
// StatusPill for the few places that label a state rather than a value.
//
// `sm` is the size a flag takes inside a dense table row, beside a name it
// qualifies (a budget's "Låst", a product's expiry). It used to be written out
// by hand at each of those, at three slightly different paddings.
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
  /** The longer explanation, for a pointer. */
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
