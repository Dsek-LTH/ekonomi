"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { REIMBURSEMENT_DEADLINE_DAYS, type SubmitBlocker } from "@/lib/domain/status";
import type { PaymentType } from "@/lib/domain/types";
import { cn } from "@/lib/ui/utils";

// Why the utlägg can't be sent for attest yet, said in one place because both
// surfaces that say it (the wizard's last step and the detail page's notice)
// have to say the same thing.
//
// The submit button is not rendered while a blocker stands (see `submitBlocker`
// in lib/domain/status.ts), so this sentence is the whole of what the submitter
// is given. That is fine for the blockers they fix on the form in front of them
// and useless for the one they cannot: "add your clearing and account number
// under Min profil" names a page and then leaves them to go and find it.
const BLOCKER_LINK: Partial<Record<SubmitBlocker, { href: string; label: string }>> = {
  payout: { href: "/profile", label: "common.action.goToProfile" },
};

/**
 * Blockers whose sentence depends on what kind of utlägg it is.
 *
 * Only one so far. The filing deadline applies to a milersättning exactly as it
 * does to an eget utlägg, but the wording cannot: "det här kvittot är äldre än
 * så" names a document a mileage claim does not have, on the one screen whose
 * job is to say precisely what is wrong. The rule is shared; the sentence is
 * not.
 *
 * A map rather than a condition, so the next one to diverge is a line here
 * rather than another branch in the JSX.
 */
const MILEAGE_WORDING: Partial<Record<SubmitBlocker, string>> = {
  tooLate: "tooLateMileage",
};

export function SubmitBlockerNote({
  blocker,
  paymentType,
  className,
}: {
  blocker: SubmitBlocker;
  /** What kind of utlägg this is about. Only MILEAGE changes anything, see
   *  MILEAGE_WORDING, so it is optional, and every other caller can leave it
   *  off. */
  paymentType?: PaymentType;
  className?: string;
}) {
  const t = useTranslations("expenses.submitBlocker");
  const tCommon = useTranslations();
  const link = BLOCKER_LINK[blocker];
  const key = (paymentType === "MILEAGE" && MILEAGE_WORDING[blocker]) || blocker;

  return (
    <p className={className}>
      {/* `days` is only read by the filing-deadline hint; next-intl ignores it
          on the others, which is cheaper than picking values per blocker. */}
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
