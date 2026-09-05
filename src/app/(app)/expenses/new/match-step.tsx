"use client";

// The wizard's second step, for a card purchase: which row on the statement
// this utlägg accounts for.
//
// Its own file because it is the one step of the three that is genuinely
// separable. It asks a single question, and everything it needs to ask it (the
// candidate rows, which one is picked) is a handful of values rather than the
// whole draft. The review and submit steps are the form itself, and threading
// fifteen pieces of wizard state through a prop list would move the complexity
// rather than remove it.
import { useTranslations } from "next-intl";

import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { IconLink } from "@/components/ui/icons";
import { formatSEK } from "@/lib/ui/format";
import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";
import type { BankTransaction } from "@/lib/domain/types";

import { optionCard, StepFooter } from "./step-chrome";

/**
 * A statement row this utlägg could account for.
 *
 * `selectable` is false for a near miss, which is kept in the list and shown
 * greyed rather than filtered out: seeing a 249,50 purchase sitting there is
 * what tells somebody the amount was mistyped, which an empty list never would.
 */
export interface Candidate {
  txn: BankTransaction;
  selectable: boolean;
}

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
  candidates: Candidate[];
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
  const tList = useTranslations("expenses");
  const { date } = useFormat();

  return (
    <Card>
      <CardBody className="space-y-5">
        <div>
          <h2 className="text-base font-semibold">{t("matchTitle")}</h2>
          <p className="mt-1 text-sm text-muted">
            {t("matchLead", { amount: formatSEK(Math.abs(grossSEK)) })}
          </p>
        </div>

        <ul className="space-y-2.5">
          {candidates.map(({ txn, selectable }, i) => {
            const selected = matchId === txn.id;
            // The best guess, and only where it is actually a match: the list
            // is sorted selectable-first and then by closeness.
            const suggested = selectable && i === 0;
            return (
              <li key={txn.id}>
                <button
                  disabled={!selectable}
                  title={selectable ? undefined : t("amountMismatch")}
                  onClick={() => onPick(txn.id)}
                  className={cn(
                    optionCard(selected),
                    "flex items-center gap-3",
                    !selectable && "cursor-not-allowed opacity-45 hover:bg-transparent",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-9 items-center justify-center rounded-full",
                      selected ? "brand-fill text-on-brand" : "bg-surface text-muted",
                    )}
                  >
                    <IconLink className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{txn.description}</p>
                      {suggested && (
                        <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success">
                          {t("suggested")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted">
                      {date(txn.transactionDate)}
                      {!selectable && ` – ${t("otherAmount")}`}
                    </p>
                  </div>
                  <Amount value={txn.amount} />
                </button>
              </li>
            );
          })}
          {candidates.length === 0 && (
            <li className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
              {t("noCandidates")}
            </li>
          )}
        </ul>

        <p className="text-xs text-muted">{tList("noMatchHint")}</p>

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
