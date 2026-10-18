"use client";

// Which card purchase an utlägg is: the bank rows on the member's card, ranked
// for this claim by lib/domain/matching.ts.
//
// Mostly there is one answer, so mostly that is all this shows. Once a row is
// picked the list folds to that one line with a way to change it. Until then
// it shows the rows that can be picked, then any that are very likely this
// purchase with the amount typed wrong (each with the fix: take its amount),
// and everything else behind one link, for looking. How matching works is
// behind a "?" (MatchHelp) rather than written out above the list, where it
// was three paragraphs on the smallest card of the form.
//
// One line per row: day, text, why it cannot be picked, amount. They were two
// lines each, with the reason as a sentence under the date.
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { IconCheck } from "@/components/ui/icons";
import { SearchInput } from "@/components/ui/search-input";
import { Spinner } from "@/components/ui/spinner";
import { Tag } from "@/components/ui/status-pill";
import { formatSEK } from "@/lib/ui/format";
import type { MatchCandidate } from "@/lib/domain/matching";
import type { BankTransaction } from "@/lib/domain/types";
import { cn } from "@/lib/ui/utils";

type Candidate = MatchCandidate<BankTransaction>;

// Day, text, then whatever is at the end. The day is short and fixed-width so
// a column of them lines up and the texts start in one place.
//
// Below sm the end goes onto a line of its own under the text. On one line it
// took what it needed (a tag, "Använd beloppet", the amount) and the text was
// left with nothing, while the end ran out over the card's edge.
const ROW =
  "grid grid-cols-[3.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[3.75rem_minmax(0,1fr)_auto]";
/** The end of a row: under the text on a phone, its own column from sm. */
const END = "col-start-2 flex flex-wrap items-center gap-x-3 gap-y-2 sm:col-start-3 sm:justify-end";
/** The text: wraps on a phone, where there is a line for it, one line from sm. */
const TEXT = "min-w-0 break-words sm:truncate";

export function TransactionPicker({
  candidates,
  selectedId,
  onPick,
  amount,
  onUseAmount,
  busy = false,
  pendingId = null,
}: {
  candidates: Candidate[];
  selectedId?: string | null;
  onPick: (id: string) => void;
  /** The claim's amount, a magnitude, for the line said when nothing fits. */
  amount: number;
  /**
   * Take a row's amount as the utlägg's and pick it. Offered on a row that is
   * very likely this purchase typed wrong (see `fixable`). Left out where the
   * amount cannot be changed from here.
   */
  onUseAmount?: (txn: BankTransaction) => void;
  busy?: boolean;
  pendingId?: string | null;
}) {
  const t = useTranslations("expenses.match");
  const day = useShortDay();
  const [query, setQuery] = useState("");
  const [allOpen, setAllOpen] = useState(false);
  // Folded to the picked row until asked to change it.
  const [changing, setChanging] = useState(false);

  const picked = candidates.find((c) => c.txn.id === selectedId && c.selectable);
  const pickable = candidates.filter((c) => c.selectable);
  const nearMisses = candidates.filter((c) => c.fixable);
  const rest = candidates.filter((c) => !c.selectable && !c.fixable);

  const q = query.trim().toLowerCase();
  const searched = useMemo(
    () =>
      q
        ? candidates.filter(
            (c) =>
              c.txn.description.toLowerCase().includes(q) ||
              formatSEK(Math.abs(c.txn.amount)).includes(q) ||
              String(Math.abs(c.txn.amount)).includes(q),
          )
        : null,
    [candidates, q],
  );

  if (picked && !changing) {
    return (
      <div className={cn(ROW, "rounded-panel border border-accent bg-accent-soft/40 px-3 py-2.5 text-sm")}>
        <span className="tabular-nums text-muted">{day(picked.txn.transactionDate)}</span>
        <span className="flex min-w-0 items-center gap-2">
          <IconCheck className="size-4 shrink-0 text-success" />
          <span className={cn(TEXT, "font-medium")}>{picked.txn.description}</span>
        </span>
        <span className={END}>
          <Amount value={picked.txn.amount} />
          <button
            type="button"
            onClick={() => setChanging(true)}
            disabled={busy}
            className="text-sm font-medium text-accent hover:underline disabled:opacity-40"
          >
            {t("change")}
          </button>
        </span>
      </div>
    );
  }

  const row = (c: Candidate) => (
    <CandidateRow
      key={c.txn.id}
      c={c}
      day={day}
      selected={selectedId === c.txn.id}
      busy={busy}
      pending={busy && pendingId === c.txn.id}
      onPick={(id) => {
        onPick(id);
        setChanging(false);
      }}
      onUseAmount={onUseAmount}
    />
  );

  return (
    <div className="space-y-2">
      {pickable.length === 0 && !searched && (
        <p className="text-sm text-muted">{t("noneFits", { amount: formatSEK(amount) })}</p>
      )}

      {!searched && (pickable.length > 0 || nearMisses.length > 0) && (
        <ul className="divide-y divide-border rounded-panel border border-border">
          {pickable.map(row)}
          {nearMisses.map(row)}
        </ul>
      )}

      {(allOpen || searched) && (
        <>
          {candidates.length > 6 && (
            <SearchInput
              placeholder={t("search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          {(searched ?? rest).length > 0 ? (
            <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-panel border border-border">
              {(searched ?? rest).map(row)}
            </ul>
          ) : (
            <p className="px-1 text-sm text-muted">
              {candidates.length === 0 ? t("noneAtAll") : t("noneMatchSearch")}
            </p>
          )}
        </>
      )}

      {rest.length > 0 && !searched && (
        <button
          type="button"
          aria-expanded={allOpen}
          onClick={() => setAllOpen((o) => !o)}
          className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline"
        >
          {allOpen ? t("hideOthers") : t("showAll", { count: rest.length })}
        </button>
      )}
      {candidates.length === 0 && <p className="text-sm text-muted">{t("noneAtAll")}</p>}
    </div>
  );
}

function CandidateRow({
  c,
  day,
  selected,
  busy,
  pending,
  onPick,
  onUseAmount,
}: {
  c: Candidate;
  day: (iso: string) => string;
  selected: boolean;
  busy: boolean;
  pending: boolean;
  onPick: (id: string) => void;
  onUseAmount?: (txn: BankTransaction) => void;
}) {
  const t = useTranslations("expenses.match");
  const { txn } = c;

  // Why it cannot be picked, as a tag rather than a sentence: what the eye
  // looks for on a row it expected to be able to pick.
  const tag =
    c.blocked === "amount"
      ? { tone: "warning" as const, text: `${c.offBy > 0 ? "+" : "−"}${formatSEK(Math.abs(c.offBy))}` }
      : c.blocked === "direction"
        ? { tone: "neutral" as const, text: txn.amount > 0 ? t("incoming") : t("outgoing") }
        : c.blocked === "taken"
          ? {
              tone: "neutral" as const,
              text: txn.matchedExpenseRef ? t("takenBy", { reference: txn.matchedExpenseRef }) : t("taken"),
            }
          : null;

  const content = (
    <>
      <span className="tabular-nums text-muted">{day(txn.transactionDate)}</span>
      <span className={cn(TEXT, c.selectable ? "font-medium" : "text-muted")}>
        {txn.description}
      </span>
      <span className={END}>
        {tag && (
          <Tag tone={tag.tone} size="sm" className="tabular-nums">
            {tag.text}
          </Tag>
        )}
        {c.fixable && onUseAmount && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onUseAmount(txn)}>
            {t("useAmount", { amount: formatSEK(Math.abs(txn.amount)) })}
          </Button>
        )}
        <span className={cn(!c.selectable && "text-muted")}>
          <Amount value={txn.amount} />
        </span>
        {pending && <Spinner size="sm" className="text-accent" />}
      </span>
    </>
  );

  if (!c.selectable) {
    return <li className={cn(ROW, "px-3 py-2 text-sm")}>{content}</li>;
  }
  return (
    <li>
      <button
        type="button"
        disabled={busy}
        aria-pressed={selected}
        onClick={() => onPick(txn.id)}
        className={cn(
          ROW,
          "w-full px-3 py-2.5 text-left text-sm transition-colors disabled:pointer-events-none",
          selected ? "bg-accent-soft/40" : "hover:bg-hover",
        )}
      >
        {content}
      </button>
    </li>
  );
}

// "12 okt", the day and the month and nothing else: every row is on the
// member's card this year or last, and the year would be most of the width.
function useShortDay() {
  const locale = useLocale();
  return useMemo(() => {
    const f = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "sv-SE", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
    return (iso: string) => f.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)).replace(".", "");
  }, [locale]);
}

/** How matching works, behind a "?" beside the heading rather than above the list. */
export function MatchHelp() {
  const t = useTranslations("expenses.match");
  return (
    <InfoHint label={t("helpLabel")}>
      <span className="block space-y-1.5">
        <span className="block">{t("help1")}</span>
        <span className="block">{t("help2")}</span>
        <span className="block">{t("help3")}</span>
        <span className="block">{t("help4")}</span>
      </span>
    </InfoHint>
  );
}
