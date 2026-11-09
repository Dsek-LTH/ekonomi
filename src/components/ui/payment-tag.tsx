import { useTranslations } from "next-intl";

import { PAYMENT_CLASSES, PAYMENT_TEXT } from "@/lib/domain/status";
import type { PaymentType } from "@/lib/domain/types";
import { cn } from "@/lib/ui/utils";
import { IconCar, IconCard, IconPerson } from "./icons";

// Word, icon and colour together: colour is never the only signal. An outlined chip, unlike StatusPill, so the two read as different questions.

const PAYMENT_ICONS: Record<PaymentType, (p: { className?: string }) => React.ReactElement> = {
  CARD: IconCard,
  REIMBURSEMENT: IconPerson,
  MILEAGE: IconCar,
};

/** The icon alone, in its type's own colour, for the wizard's picker. */
export function PaymentIcon({ type, className }: { type: PaymentType; className?: string }) {
  const Icon = PAYMENT_ICONS[type];
  return <Icon className={cn(PAYMENT_TEXT[type], className)} />;
}

export function PaymentTag({
  type,
  /** Icon alone below md (where DataTable swaps cards for the table). sr-only, not hidden: the word stays in the accessibility tree. */
  compact = false,
  className,
}: {
  type: PaymentType;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("common.payment");
  const Icon = PAYMENT_ICONS[type];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-control border text-xs font-medium",
        compact ? "px-1.5 py-1 md:px-2 md:py-0.5" : "px-2 py-0.5",
        PAYMENT_CLASSES[type],
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      {/* not-sr-only resets white-space to normal, so it is set back. */}
      <span className={compact ? "sr-only md:not-sr-only md:whitespace-nowrap" : undefined}>
        {t(`${type}.label`)}
      </span>
    </span>
  );
}
