import { getBoardPrices } from "@/lib/data/board";
import { today } from "@/lib/domain/date";
import { canBookkeep, canViewBookkeeping, hasBoardTab } from "@/lib/domain/permissions";
import { requirePage } from "@/lib/server/current-user";
import { titled } from "@/lib/server/page-title";

import BoardPricesClient from "./prices-client";

export const generateMetadata = titled("boardPrices");

// What the board pays per product. Read by anybody with a tab, kept by the treasury.
export default async function BoardPricesPage() {
  const user = await requirePage((caps) => hasBoardTab(caps) || canViewBookkeeping(caps));
  return (
    <BoardPricesClient
      prices={await getBoardPrices()}
      today={today()}
      canManage={canBookkeep(user.capabilities)}
    />
  );
}
