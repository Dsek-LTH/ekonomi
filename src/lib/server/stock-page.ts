// The gate every page under /stock/[stock] goes through: the segment names one of the fixed stocks, and the
// reader holds the capability for that one, or a place in it.
import "server-only";

import { notFound, redirect } from "next/navigation";
import {
  canEnterStock,
  canManageStock,
  canMoveStock,
  canViewStock,
  type StockReach,
} from "@/lib/domain/permissions";
import type { SessionUser } from "@/lib/domain/types";
import { requireUser } from "@/lib/server/current-user";
import { isStockSlug, type StockSlug } from "@/lib/stock/stocks";

type Level = "enter" | "view" | "manage" | "move";

const CAN: Record<Level, (who: StockReach, stock: StockSlug) => boolean> = {
  /** Reading the stock, or only logging moves in it: what the layout asks, since it wraps both. */
  enter: canEnterStock,
  view: (who, stock) => canViewStock(who.capabilities, stock),
  manage: (who, stock) => canManageStock(who.capabilities, stock),
  move: canMoveStock,
};

export async function requireStockPage(
  params: Promise<{ stock: string }>,
  level: Level = "view",
): Promise<{ user: SessionUser; stock: StockSlug }> {
  const { stock } = await params;
  if (!isStockSlug(stock)) notFound();
  const user = await requireUser();
  if (!CAN[level](user, stock)) redirect("/dashboard");
  return { user, stock };
}
