"use client";

// A redovisningsbetyg on screen: the number and the breakdown that says why. Used on /profile and the
// Medlemmar tab. See lib/domain/member-score.ts for what it measures.
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ButtonLink } from "@/components/ui/button";
import {
  MIN_COUNTED,
  SUB_SCORES,
  type MemberScore,
  type ScoreItem,
  type SubScoreKey,
} from "@/lib/domain/member-score";
import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";

/** The colour a score is drawn in: red at 0, amber at 50, green at 100, mixed from the theme's tokens. */
function scoreColor(value: number): string {
  const v = Math.min(100, Math.max(0, value));
  return v < 50
    ? `color-mix(in oklch, var(--color-warning) ${v * 2}%, var(--color-danger))`
    : `color-mix(in oklch, var(--color-success) ${(v - 50) * 2}%, var(--color-warning))`;
}

/** A score from 0 to 100, or "Ny" while there is nothing to go on. `quiet` is smaller, for member lists. */
export function ScoreNumber({
  value,
  size = "sm",
  quiet = false,
}: {
  value: number | null;
  size?: "sm" | "md" | "lg";
  quiet?: boolean;
}) {
  const t = useTranslations("score");
  if (value === null) {
    return (
      <span className="inline-flex h-5 items-center rounded-control bg-surface px-1.5 text-xs font-medium text-muted">
        {t("new")}
      </span>
    );
  }
  const text =
    size === "lg" ? "text-4xl" : size === "md" ? "text-2xl" : quiet ? "text-sm" : "text-base";
  return (
    <span
      role="img"
      aria-label={t("scoreLabel", { value })}
      className={cn("inline-block font-bold leading-none tabular-nums", text)}
      style={{
        backgroundImage: `linear-gradient(135deg, ${scoreColor(value - 20)}, ${scoreColor(value)})`,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
      }}
    >
      {value}
    </span>
  );
}

/** What each sub-score shows under its number: the count behind it. */
function partDetail(t: ReturnType<typeof useTranslations>, key: SubScoreKey, s: MemberScore) {
  switch (key) {
    case "promptness":
      return t("parts.promptnessDetail", { count: s.parts.promptness.counted });
    case "firstTime":
      return t("parts.ofDetail", { count: s.firstTime.clean, of: s.firstTime.of });
    case "attestAccuracy":
      return t("parts.ofDetail", { count: s.accuracy.correct, of: s.accuracy.of });
    case "attestSpeed":
      return t("parts.attestSpeedDetail", { count: s.parts.attestSpeed.counted });
  }
}

/** The whole of one member's score. `own` when it is the reader's, which gives what waits a button. */
export function MemberScorePanel({ score, own }: { score: MemberScore; own: boolean }) {
  const t = useTranslations("score");
  const { date } = useFormat();
  const scored = SUB_SCORES.filter((k) => score.parts[k].value !== null).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ScoreNumber value={score.score} size="lg" />
        <div>
          {score.score !== null ? (
            <>
              <p className="text-base font-semibold tabular-nums">{t("outOf")}</p>
              <p className="text-sm text-muted">{t("basedOn", { count: scored })}</p>
            </>
          ) : (
            <p className="text-sm text-muted">{t("newDescription", { min: MIN_COUNTED })}</p>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3">
        {SUB_SCORES.map((k) => (
          <div key={k} className="rounded-panel border border-border px-3 py-2.5">
            <dt className="text-xs text-muted">{t(`parts.${k}`)}</dt>
            <dd className="mt-1 flex items-baseline gap-2">
              <ScoreNumber value={score.parts[k].value} size="md" />
            </dd>
            <dd className="mt-1 text-xs text-muted tabular-nums">
              {score.parts[k].value === null
                ? t("parts.notEnough", { min: MIN_COUNTED })
                : partDetail(t, k, score)}
            </dd>
          </div>
        ))}
      </dl>

      {score.waiting.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold">{t("waitingTitle")}</h3>
          <p className="mt-0.5 text-sm text-muted">{own ? t("waitingOwn") : t("waitingOther")}</p>
          <ItemList
            items={score.waiting}
            action={
              own
                ? (i) => (
                    <ButtonLink size="sm" variant="secondary" href={waitingHref(i)}>
                      {i.kind === "draft" ? t("send") : t("redovisa")}
                    </ButtonLink>
                  )
                : undefined
            }
          />
        </section>
      )}

      {score.attestWaiting.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold">{t("attestWaitingTitle")}</h3>
          <p className="mt-0.5 text-sm text-muted">
            {own ? t("attestWaitingOwn") : t("attestWaitingOther")}
          </p>
          <ItemList items={score.attestWaiting} />
        </section>
      )}

      {score.returnedAttests.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold">{t("returnedTitle")}</h3>
          <p className="mt-0.5 text-sm text-muted">{t("returnedLead")}</p>
          <ul className="mt-2 divide-y divide-border rounded-panel border border-border">
            {score.returnedAttests.slice(0, 10).map((a) => (
              <li key={`${a.record}-${a.id}-${a.signedOn}`} className="px-3 py-2.5">
                <Link
                  href={recordHref(a.record, a.id)}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {a.title || t(`kind.${a.record}`)}
                </Link>
                <p className="text-xs text-muted">
                  {t(`kind.${a.record}`)} - {t("attestedOn", { date: date(a.signedOn!) })}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="text-sm font-semibold">{t("slowestTitle")}</h3>
        {score.items.length === 0 ? (
          <p className="mt-1 text-sm text-muted">{t("nothingCounted")}</p>
        ) : (
          <ItemList items={score.items.slice(0, 10)} />
        )}
      </section>

      {score.attests.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold">{t("slowestAttestsTitle")}</h3>
          <ItemList items={score.attests.slice(0, 10)} />
        </section>
      )}

      <section>
        <h3 className="text-sm font-semibold">{t("howTitle")}</h3>
        <p className="mt-1 text-sm text-muted">{t("how")}</p>
      </section>
    </div>
  );
}

/** A timed breakdown: what it was, when it started, how long, its points. */
function ItemList({
  items,
  action,
}: {
  items: ScoreItem[];
  action?: (i: ScoreItem) => React.ReactNode;
}) {
  const t = useTranslations("score");
  const { date } = useFormat();
  return (
    <ul className="mt-2 divide-y divide-border rounded-panel border border-border">
      {items.map((i) => {
        const kind = t(`kind.${kindKey(i)}`);
        const done = i.kind === "submitted" || i.kind === "attested";
        return (
          <li
            key={`${i.kind}-${i.id}-${i.startedOn}`}
            className="flex items-center gap-3 px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              {i.kind === "cardPurchase" ? (
                <p className="truncate text-sm font-medium">{i.title || kind}</p>
              ) : (
                <Link
                  href={recordHref(i.record ?? "expense", i.id)}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {i.title || kind}
                </Link>
              )}
              <p className="text-xs text-muted">
                {kind} - {date(i.startedOn)} -{" "}
                {done ? t("tookDays", { days: i.days }) : t("waitedDays", { days: i.days })}
              </p>
            </div>
            <ScoreNumber value={i.points} quiet />
            {action?.(i)}
          </li>
        );
      })}
    </ul>
  );
}

const kindKey = (i: ScoreItem) =>
  i.kind === "cardPurchase" || i.kind === "draft" ? i.kind : (i.record ?? "expense");

const recordHref = (record: "expense" | "invoice", id: string) =>
  record === "invoice" ? `/invoices/${id}` : `/expenses/${id}`;

/** Where to go to send it: the draft's own form, or a new utlägg on the card purchase (as Bankhändelser's Redovisa). */
const waitingHref = (i: ScoreItem) =>
  i.kind === "cardPurchase" ? `/expenses/new?txn=${i.id}` : `/expenses/${i.id}/edit`;
