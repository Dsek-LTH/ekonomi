import { redirect } from "next/navigation";

import { getBoardWithdrawals, getClosedTabs, hasWithdrawals } from "@/lib/data/board";
import { canBookkeep, hasBoardTab } from "@/lib/domain/permissions";
import { requireUser } from "@/lib/server/current-user";
import { titled } from "@/lib/server/page-title";

import HistoryClient from "./history-client";

export const generateMetadata = titled("boardHistory");

// Mina uttag: a member's running tab. What is open now, as a receipt, and the tabs already invoiced. Somebody who has
// left the board still reaches it while it holds rows.
export default async function BoardHistoryPage() {
  const user = await requireUser();
  const member = hasBoardTab(user.capabilities);
  if (!member && !(await hasWithdrawals(user.id))) redirect("/dashboard");

  const [open, closed] = await Promise.all([
    getBoardWithdrawals({ memberId: user.id, invoiced: false }),
    getClosedTabs(user.id),
  ]);

  return (
    <HistoryClient
      open={open}
      closed={closed}
      canLog={member}
      canManage={canBookkeep(user.capabilities)}
    />
  );
}
