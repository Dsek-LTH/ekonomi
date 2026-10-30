"use client";

// A redovisningsbetyg on screen: the stars, and the breakdown that says why.
// The same panel on /profile, for the member's own, and on the profile's
// Medlemmar tab for the treasury. See lib/domain/member-score.ts for what the
// stars measure.
//
// The breakdown is not optional decoration. Stars nobody can explain read as a
// verdict; stars with "these two waited a month" under them read as something
// to do.
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ButtonLink } from "@/components/ui/button";
import { MIN_COUNTED, type MemberScore, type ScoreItem } from "@/lib/domain/member-score";
import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";

const STAR_PATH =
  "M12 2.8l2.75 5.57 6.15.9-4.45 4.33 1.05 6.12L12 16.83l-5.5 2.89 1.05-6.12L3.1 9.27l6.15-.9L12 2.8z";

function Star({ fill, className, ink }: { fill: number; className: string; ink: string }) {
  return (
    <span className={cn("relative inline-block shrink-0", className)}>
      <svg viewBox="0 0 24 24" className="absolute inset-0 size-full text-border" aria-hidden>
        <path d={STAR_PATH} fill="currentColor" />
      </svg>
      {/* The filled part, cut to the fraction this star holds: a half star is
          the left half of one. */}
      <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
        <svg viewBox="0 0 24 24" className={cn(ink, className)} aria-hidden>
          <path d={STAR_PATH} fill="currentColor" />
        </svg>
      </span>
    </span>
  );
}

/**
 * Five stars, or "Ny" while there is nothing to go on yet.
 *
 * `quiet` for a list of members, where the stars sit beside every name: smaller
 * and in grey rather than gold, so a page of them reads as a column of figures
 * and not as a row of prizes. The gold is for the member's own.
 */
export function StarRating({
  value,
  size = "sm",
  quiet = false,
}: {
  value: number | null;
  size?: "sm" | "lg";
  quiet?: boolean;
}) {
  const t = useTranslations("score");
  const locale = useLocale();
  if (value === null) {
    return (
      <span className="inline-flex h-5 items-center rounded-control bg-surface px-1.5 text-xs font-medium text-muted">
        {t("new")}
      </span>
    );
  }
  const star = size === "lg" ? "size-7" : quiet ? "size-3" : "size-4";
  const ink = quiet ? "text-muted" : "text-warning";
  return (
    <span
      role="img"
      aria-label={t("starsLabel", { value: value.toLocaleString(locale) })}
      className="inline-flex items-center gap-0.5"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <Star key={i} fill={Math.min(1, Math.max(0, value - i))} className={star} ink={ink} />
      ))}
    </span>
  );
}

/** Sent within the grace week, of everything sent. */
export const withinWeek = (s: MemberScore) => {
  const sent = s.items.filter((i) => i.kind === "submitted");
  return { count: sent.filter((i) => i.stars === 5).length, of: sent.length };
};

/**
 * The whole of one member's score. `own` when it is the reader's, which is
 * what decides whether what waits gets a button to go and send it.
 */
export function MemberScorePanel({ score, own }: { score: MemberScore; own: boolean }) {
  const t = useTranslations("score");
  const locale = useLocale();
  const { date } = useFormat();
  const week = withinWeek(score);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <StarRating value={score.stars} size="lg" />
        <div>
          {score.stars !== null ? (
            <>
              <p className="text-base font-semibold tabular-nums">
                {t("outOf", { value: score.stars.toLocaleString(locale) })}
              </p>
              <p className="text-sm text-muted">{t("basedOn", { count: score.counted })}</p>
            </>
          ) : (
            <p className="text-sm text-muted">{t("newDescription", { min: MIN_COUNTED })}</p>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-4">
        <div>
          <dt className="text-xs text-muted">{t("withinWeek")}</dt>
          <dd className="text-sm font-medium tabular-nums">{t("withinWeekValue", week)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t("firstTime")}</dt>
          <dd className="text-sm font-medium tabular-nums">{t("firstTimeValue", score.firstTime)}</dd>
        </div>
      </dl>

      {score.waiting.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold">{t("waitingTitle")}</h3>
          <p className="mt-0.5 text-sm text-muted">{own ? t("waitingOwn") : t("waitingOther")}</p>
          <ul className="mt-2 divide-y divide-border rounded-panel border border-border">
            {score.waiting.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{i.title || t(`kind.${waitingKind(i)}`)}</p>
                  <p className="text-xs text-muted">
                    {t(`kind.${waitingKind(i)}`)} - {date(i.startedOn)} - {t("waitedDays", { days: i.days })}
                  </p>
                </div>
                <StarRating value={i.stars} />
                {own && (
                  <ButtonLink size="sm" variant="secondary" href={waitingHref(i)}>
                    {i.kind === "draft" ? t("send") : t("redovisa")}
                  </ButtonLink>
                )}
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
          <ul className="mt-2 divide-y divide-border rounded-panel border border-border">
            {score.items.slice(0, 10).map((i) => (
              <li key={`${i.kind}-${i.id}`} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  {i.kind === "cardPurchase" ? (
                    <p className="truncate text-sm font-medium">{i.title}</p>
                  ) : (
                    <Link href={`/expenses/${i.id}`} className="block truncate text-sm font-medium hover:underline">
                      {i.title}
                    </Link>
                  )}
                  <p className="text-xs text-muted">
                    {date(i.startedOn)} -{" "}
                    {i.kind === "submitted" ? t("tookDays", { days: i.days }) : t("waitedDays", { days: i.days })}
                  </p>
                </div>
                <StarRating value={i.stars} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold">{t("howTitle")}</h3>
        <p className="mt-1 text-sm text-muted">{t("how")}</p>
      </section>
    </div>
  );
}

const waitingKind = (i: ScoreItem) => (i.kind === "cardPurchase" ? "cardPurchase" : "draft");

/** Where to go to send it: the draft's own form, or a new utlägg on the card
 *  purchase, the way Bankhändelser's Redovisa opens one. */
const waitingHref = (i: ScoreItem) =>
  i.kind === "cardPurchase" ? `/expenses/new?txn=${i.id}` : `/expenses/${i.id}/edit`;
