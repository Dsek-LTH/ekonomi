"use client";

// The wizard's third step: which row on the section card paid for this.
//
// The list, the ranking and every sentence explaining why a row cannot be
// picked are components/transaction-picker.tsx, shared with the detail page so
// the same question is not answered two different ways. What is left here is
// the step around it: the lead, the note for when nothing can be picked, and
// the footer.
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { NoMatchNote, TransactionPicker } from "@/components/transaction-picker";
import { StepFooter } from "./step-chrome";
import { formatSEK } from "@/lib/ui/format";
import type { MatchCandidate } from "@/lib/domain/matching";
import type { BankTransaction } from "@/lib/domain/types";

export function MatchStep({
  candidates,
  matchId,
  onPick,
  grossSEK,
  onBack,
  onSave,
  saveLabel,
  saveDisabled,
  saving,
  canContinue,
  onContinue,
}: {
  candidates: MatchCandidate<BankTransaction>[];
  matchId: string | null;
  onPick: (id: string) => void;
  /** What is being accounted for, for the lead line. */
  grossSEK: number;
  onBack: () => void;
  onSave: () => void;
  saveLabel: string;
  saveDisabled: boolean;
  saving: boolean;
  canContinue: boolean;
  onContinue: () => void;
}) {
  const t = useTranslations("expenses.wizard");
  const tMatch = useTranslations("expenses.match");

  // Nothing here can settle the claim. Not the same as an empty list: the rows
  // may all be there and all be unusable, which is a different sentence and the
  // one members were left to guess at.
  const stuck = !candidates.some((c) => c.selectable);

  return (
    <Card>
      <CardBody className="space-y-5">
        <div>
          <h2 className="text-base font-semibold">{t("matchTitle")}</h2>
          <p className="mt-1 text-sm text-muted">
            {tMatch("lead", { amount: formatSEK(Math.abs(grossSEK)) })}
          </p>
        </div>

        <TransactionPicker
          candidates={candidates}
          selectedId={matchId}
          onPick={onPick}
        />

        {/* Only where it is the answer. Under a list with a pickable row it
            would be a warning about a problem the member does not have. */}
        {stuck && <NoMatchNote hasRows={candidates.length > 0} />}

        <StepFooter
          onBack={onBack}
          onSave={onSave}
          saveLabel={saveLabel}
          saveDisabled={saveDisabled}
          saving={saving}
        >
          <Button disabled={!canContinue} onClick={onContinue}>
            {t("continue")}
          </Button>
        </StepFooter>
      </CardBody>
    </Card>
  );
}
