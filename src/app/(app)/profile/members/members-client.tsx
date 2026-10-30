"use client";

// Every member's redovisningsbetyg, the lowest first, since those are the ones
// to talk to. A list rather than a table: a face, a name, the stars and what
// waits is all a row needs. A row opens the same
// breakdown the member sees on their own profile.
import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyNote } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { IconChevronRight } from "@/components/ui/icons";
import { MemberScorePanel, StarRating } from "@/components/member-score";
import { UserAvatar } from "@/components/ui/avatar";
import type { MemberScoreRow } from "@/lib/data/member-score";
import { profileTabs } from "../profile-client";

/** Lowest first, and "Ny" after everyone with stars: nothing to go on is not
 *  a low score. Then whoever has the most waiting. */
const byConcern = (a: MemberScoreRow, b: MemberScoreRow) =>
  (a.score.stars ?? 6) - (b.score.stars ?? 6) ||
  b.score.waiting.length - a.score.waiting.length ||
  a.name.localeCompare(b.name, "sv");

export function MembersClient({
  title,
  rows,
  selected,
}: {
  title: string;
  rows: MemberScoreRow[];
  selected: MemberScoreRow | null;
}) {
  const tProfile = useTranslations("profile");
  const t = useTranslations("score.list");
  const [query, setQuery] = useState("");

  if (selected) {
    return (
      <PageShell title={title} width="content" pages={profileTabs(tProfile, "members")} back="/profile/members">
        <Card>
          <CardBody className="space-y-5">
            <div className="flex items-center gap-3">
              <UserAvatar userId={selected.userId} name={selected.name} size="md" />
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold">{selected.name}</h2>
                <p className="truncate text-sm text-muted">{selected.email}</p>
              </div>
            </div>
            <MemberScorePanel score={selected.score} own={false} />
          </CardBody>
        </Card>
      </PageShell>
    );
  }

  const q = query.trim().toLowerCase();
  const shown = rows
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q))
    .sort(byConcern);

  return (
    <PageShell title={title} width="content" pages={profileTabs(tProfile, "members")}>
      <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} />
      <Card>
        {shown.length === 0 ? (
          <EmptyNote>{rows.length === 0 ? t("empty") : t("noMatch")}</EmptyNote>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((r) => (
              <li key={r.userId}>
                <Link
                  href={`/profile/members?id=${r.userId}`}
                  className="flex items-center gap-3 px-inset py-3 hover:bg-hover"
                >
                  <UserAvatar userId={r.userId} name={r.name} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.name}</span>
                    <span className="block truncate text-xs text-muted">
                      <WaitingSummary row={r} />
                    </span>
                  </span>
                  <StarRating value={r.score.stars} quiet />
                  <IconChevronRight className="size-4 shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </PageShell>
  );
}

/** "2 köp väntar, äldsta 44 dagar", or that nothing does. */
export function WaitingSummary({ row }: { row: Pick<MemberScoreRow, "score"> }) {
  const t = useTranslations("score.list");
  const { waiting } = row.score;
  if (waiting.length === 0) return <>{t("upToDate")}</>;
  return <>{t("waitingSummary", { count: waiting.length, days: waiting[0].days })}</>;
}
