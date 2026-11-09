"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { REIMBURSEMENT_DEADLINE_DAYS, type SubmitBlocker } from "@/lib/domain/status";
import type { PaymentType } from "@/lib/domain/types";
import { cn } from "@/lib/ui/utils";

// Why the utlägg can't be sent for attest yet, shared by the wizard's last step and the detail page. The
// submit button is not rendered while a blocker stands, so this is all the submitter is given.
const BLOCKER_LINK: Partial<Record<SubmitBlocker, { href: string; label: string }>> = {
  payout: { href: "/profile", label: "common.action.goToProfile" },
};

/** Blockers whose sentence depends on the kind of utlägg (the rule is shared, the wording is not). */
const MILEAGE_WORDING: Partial<Record<SubmitBlocker, string>> = {
  tooLate: "tooLateMileage",
};

export function SubmitBlockerNote({
  blocker,
  paymentType,
  className,
}: {
  blocker: SubmitBlocker;
  /** What kind of utlägg this is about. Only MILEAGE changes anything (MILEAGE_WORDING). */
  paymentType?: PaymentType;
  className?: string;
}) {
  const t = useTranslations("expenses.submitBlocker");
  const tCommon = useTranslations();
  const link = BLOCKER_LINK[blocker];
  const key = (paymentType === "MILEAGE" && MILEAGE_WORDING[blocker]) || blocker;

  return (
    <p className={className}>
      {t(key, { days: REIMBURSEMENT_DEADLINE_DAYS })}
      {link && (
        <>
          {" "}
          <Link
            href={link.href}
            className={cn(
              "font-medium underline underline-offset-2",
              "hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/40",
            )}
          >
            {tCommon(link.label)}
          </Link>
        </>
      )}
    </p>
  );
}
