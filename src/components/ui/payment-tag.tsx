import { useTranslations } from "next-intl";

import { PAYMENT_CLASSES, PAYMENT_TEXT } from "@/lib/domain/status";
import type { PaymentType } from "@/lib/domain/types";
import { cn } from "@/lib/ui/utils";
import { IconCar, IconCard, IconPerson } from "./icons";

// How an utlägg was paid, at a glance.
//
// The three kinds are the first thing a treasurer sorts by and they were all
// the same grey tag, so a list of forty said nothing about itself until you
// opened a row. A section-card purchase is money already gone; an eget utlägg
// and a milersättning are money the section owes a person, and the second of
// those is the only one with no receipt behind it. That is worth seeing.
//
// Three signals, not one. The word is the answer and is always there; the icon
// carries it for anyone who cannot separate the hues, and survives the page
// being printed in mono; the colour is what makes a column of them scannable.
// This is the house rule, the same one the chart palette states: colour is
// never the only way to tell two things apart.
//
// An outlined chip, where StatusPill is a filled pill with a dot. The shapes
// are different on purpose. Both appear in the same row and they answer
// different questions, so they should not look like two of the same thing.

const PAYMENT_ICONS: Record<PaymentType, (p: { className?: string }) => React.ReactElement> = {
  CARD: IconCard,
  REIMBURSEMENT: IconPerson,
  MILEAGE: IconCar,
};

/**
 * The icon alone, in its type's own colour.
 *
 * For the wizard's picker, where the three sit side by side as cards with their
 * own descriptions and a chip would be a label on a label. Seeing the icon at
 * the moment of choosing is what teaches it, so the same mark in a list of
 * forty later means something.
 */
export function PaymentIcon({ type, className }: { type: PaymentType; className?: string }) {
  const Icon = PAYMENT_ICONS[type];
  return <Icon className={cn(PAYMENT_TEXT[type], className)} />;
}

export function PaymentTag({
  type,
  /**
   * Draw the icon alone until there is room for the word, at `md`, which is
   * where DataTable swaps its phone cards for the table.
   *
   * `sr-only` and not `hidden`: the word stays in the accessibility tree at
   * every width, so what a phone drops is the *drawing* of it and never the
   * information. A tag that hid its own label from a screen reader below md
   * would be the one place in the app where colour really was the only signal.
   */
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
        // No horizontal padding while it is only an icon, or the chip is a
        // lozenge with a dot rattling around in it.
        compact ? "px-1.5 py-1 md:px-2 md:py-0.5" : "px-2 py-0.5",
        PAYMENT_CLASSES[type],
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      {/* `not-sr-only` resets white-space to normal, which let the label
          wrap inside the chip in a narrow column, so it is set back. */}
      <span className={compact ? "sr-only md:not-sr-only md:whitespace-nowrap" : undefined}>
        {t(`${type}.label`)}
      </span>
    </span>
  );
}
