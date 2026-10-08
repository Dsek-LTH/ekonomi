"use client";

// Picking the bank row that settles a card purchase.
//
// One component for the two screens that ask it: the wizard's match step, and
// the detail page's picker for a claim that lost its match or never had one.
// They used to be two, and they behaved differently at the same task. The
// wizard ranked by the matching rule but showed only the five closest and had
// no way to search; the detail page searched the lot but never ranked or told
// the two directions apart. Whichever a member met first taught them something
// untrue about the other.
//
// What is drawn here is a list of *reasons*. Every row on the card is shown,
// and one that cannot be picked says why: it points the wrong way, it is the
// wrong size (and by how much), or another utlägg already claims it. The rule
// itself is `matchCandidates` in lib/domain/matching.ts, which is where it can
// be tested; nothing about which rows qualify is decided in this file.
import { useState } from "react";
import { useTranslations } from "next-intl";

import { Amount } from "@/components/ui/amount";
import { SearchInput } from "@/components/ui/search-input";
import { Spinner } from "@/components/ui/spinner";
import { formatSEK } from "@/lib/ui/format";
import type { MatchCandidate } from "@/lib/domain/matching";
import type { BankTransaction } from "@/lib/domain/types";
import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";

export function TransactionPicker({
  candidates,
  selectedId,
  onPick,
  /** A match is being written; nothing may be picked meanwhile. */
  busy = false,
  /** The row whose write is in flight, so the spinner lands on the one clicked. */
  pendingId = null,
}: {
  candidates: MatchCandidate<BankTransaction>[];
  selectedId?: string | null;
  onPick: (id: string) => void;
  busy?: boolean;
  pendingId?: string | null;
}) {
  const t = useTranslations("expenses.match");
  const { date } = useFormat();
  const [query, setQuery] = useState("");
  const [othersOpen, setOthersOpen] = useState(false);

  const q = query.trim().toLowerCase();
  // Searched, not ranked: the order is the rule's, and a search only narrows
  // it. Matching on the amount as well as the description, because "250" is
  // what somebody types when they are hunting for a figure they remember.
  const shown = q
    ? candidates.filter(
        (c) =>
          c.txn.description.toLowerCase().includes(q) ||
          formatSEK(Math.abs(c.txn.amount)).includes(q) ||
          String(Math.abs(c.txn.amount)).includes(q),
      )
    : candidates;

  // Two lists, not one. The rows that can settle this claim are the choice,
  // and there are rarely more than one or two of them. Everything else on the
  // card is only there to answer "why is my purchase not here?", so it waits
  // behind a toggle instead of burying the choice in a greyed-out scroll box.
  // It opens by itself when that is the question being asked: nothing can be
  // picked, or somebody is searching and would expect to see every hit.
  const pickable = shown.filter((c) => c.selectable);
  const others = shown.filter((c) => !c.selectable);
  const showOthers = othersOpen || pickable.length === 0 || q !== "";

  /** The one line that says why this row is not on offer. */
  function reason(c: MatchCandidate<BankTransaction>): string | null {
    switch (c.blocked) {
      case null:
        return null;
      case "direction":
        // The figure is right and the row still cannot serve, so saying
        // "another amount" here would send somebody to check a correct number.
        return c.txn.amount > 0 ? t("isIncoming") : t("isOutgoing");
      case "amount":
        return t(c.offBy > 0 ? "overBy" : "underBy", {
          amount: formatSEK(Math.abs(c.offBy)),
        });
      case "taken":
        // Named where there is a reference to name. A draft that has claimed it
        // has no reference yet, and "redan redovisad" alone is still the answer
        // to why this row cannot be taken.
        return c.txn.matchedExpenseRef
          ? t("takenBy", { reference: c.txn.matchedExpenseRef })
          : t("taken");
    }
  }

  return (
    <div className="space-y-3">
      {/* Only where there is enough to make finding one work. Under a handful
          of rows the box is a field to ignore above a list you can already
          read. */}
      {candidates.length > 6 && (
        <SearchInput
          placeholder={t("search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {pickable.length > 0 && (
        <ul className="divide-y divide-border rounded-panel border border-border">
          {pickable.map((c, i) => {
            const { txn } = c;
            const selected = selectedId === txn.id;
            // The best guess, and only where it is one: the rule ranks the
            // closest first, and with nothing picked yet that is the row to
            // point at.
            const suggested = i === 0 && !selectedId && !q && pickable.length > 1;
            return (
              <li key={txn.id}>
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={selected}
                  onClick={() => onPick(txn.id)}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors disabled:pointer-events-none",
                    selected ? "bg-surface" : "hover:bg-hover",
                  )}
                >
                  {/* A radio's dot: choosing one of these is choosing one. */}
                  <span className="grid size-4 shrink-0 place-items-center">
                    {busy && pendingId === txn.id ? (
                      <Spinner size="sm" className="text-accent" />
                    ) : (
                      <span
                        className={cn(
                          "grid size-4 place-items-center rounded-full border",
                          selected ? "border-accent" : "border-faint bg-background",
                        )}
                      >
                        {selected && <span className="size-2 rounded-full bg-accent" />}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{txn.description}</span>
                      {suggested && (
                        <span className="shrink-0 text-xs text-success">{t("suggested")}</span>
                      )}
                    </span>
                    <span className="block text-xs tabular-nums text-muted">
                      {date(txn.transactionDate)}
                    </span>
                  </span>
                  <span className="shrink-0">
                    <Amount value={txn.amount} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {others.length > 0 && (
        <div>
          {/* No toggle while it is open by necessity: hiding the only list
              there is would leave nothing to hide it in favour of. */}
          {pickable.length > 0 && !q && (
            <button
              type="button"
              aria-expanded={showOthers}
              onClick={() => setOthersOpen((o) => !o)}
              className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline"
            >
              {showOthers ? t("hideOthers") : t("showOthers", { count: others.length })}
            </button>
          )}
          {showOthers && (
            <ul
              className={cn(
                "max-h-64 divide-y divide-border overflow-y-auto rounded-panel border border-border",
                pickable.length > 0 && !q && "mt-2",
              )}
            >
              {others.map((c) => {
                const why = reason(c);
                return (
                  // Not buttons: nothing here can be picked, and a control that
                  // does nothing when pressed is worse than plain text.
                  <li key={c.txn.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-muted">{c.txn.description}</span>
                      <span className="block text-xs text-muted">
                        <span className="tabular-nums">{date(c.txn.transactionDate)}</span>
                        {/* The reason last and in its own colour: it is what
                            the eye is looking for on a row it expected to be
                            able to pick. */}
                        {why && <> - <span className="text-warning">{why}</span></>}
                      </span>
                    </span>
                    <span className="shrink-0 text-muted">
                      <Amount value={c.txn.amount} />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {shown.length === 0 && (
        <p className="rounded-panel border border-border px-4 py-6 text-center text-sm text-muted">
          {candidates.length === 0 ? t("noneAtAll") : t("noneMatchSearch")}
        </p>
      )}
    </div>
  );
}

/**
 * What to do when nothing in the list can be picked.
 *
 * Its own note rather than a line of hint text, because the situation it
 * describes is a dead end and the old copy did not say so: a card purchase
 * cannot be submitted without a match (see `submitBlocker`), so a member who
 * cannot find their row is stopped, not merely unassisted. The screen used to
 * offer a greyed-out "Fortsätt" and a paragraph guessing that the bank file was
 * unimported, which is one of four reasons and often the wrong one.
 */
export function NoMatchNote({ hasRows }: { hasRows: boolean }) {
  const t = useTranslations("expenses.match");
  return (
    <div className="rounded-control border border-border bg-surface px-4 py-3 text-xs text-muted">
      <p className="font-medium text-foreground">{t("stuckTitle")}</p>
      <p className="mt-1">{hasRows ? t("stuckWithRows") : t("stuckNoRows")}</p>
      <p className="mt-1">{t("stuckDraft")}</p>
    </div>
  );
}
