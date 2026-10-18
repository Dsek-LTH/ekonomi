"use client";

// Which card purchase this is, for a card utlägg: a section of the form rather
// than a step of its own. How matching works is behind the "?" beside the
// section's heading (MatchHelp), and saving and sending are the action bar's.

import { TransactionPicker } from "@/components/transaction-picker";
import type { MatchCandidate } from "@/lib/domain/matching";
import type { BankTransaction } from "@/lib/domain/types";

export function MatchSection({
  candidates,
  matchId,
  onPick,
  grossSEK,
  onUseAmount,
}: {
  candidates: MatchCandidate<BankTransaction>[];
  matchId: string | null;
  onPick: (id: string) => void;
  grossSEK: number;
  onUseAmount: (txn: BankTransaction) => void;
}) {
  return (
    <TransactionPicker
      candidates={candidates}
      selectedId={matchId}
      onPick={onPick}
      amount={Math.abs(grossSEK)}
      onUseAmount={onUseAmount}
    />
  );
}
