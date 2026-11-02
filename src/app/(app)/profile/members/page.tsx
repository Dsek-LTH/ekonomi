import { getTranslations } from "next-intl/server";
import { requirePage } from "@/lib/server/current-user";
import { canViewMemberScores } from "@/lib/domain/permissions";
import { getMemberScoreRow, getMemberScores } from "@/lib/data/member-score";
import { MembersClient } from "./members-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("members");

// The profile's Medlemmar tab: every member's redovisningsbetyg, for
// the holders of MEMBER_SCORE_VIEW. `?id=` opens one member's breakdown, which
// is where Översikt's "Släpar efter" and the stars on an utlägg lead.
export default async function ProfileMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  await requirePage(canViewMemberScores);
  const { id } = await searchParams;
  const t = await getTranslations("nav");
  const rows = await getMemberScores();
  // Somebody with nothing in the year is not in the list, but a link may
  // still name them.
  const selected = id ? (rows.find((r) => r.userId === id) ?? (await getMemberScoreRow(id))) : null;
  return <MembersClient title={t("members")} rows={rows} selected={selected} />;
}
