import "server-only";

// How each stock is booked, as Inställningar draws it and the export reads it.
import { prisma } from "@/lib/server/db";
import { getKnownGroups } from "@/lib/data/authority";
import { isoDay } from "@/lib/domain/date";
import type { DrinkCategory } from "@/lib/domain/types";
import { postingGaps, type StockBookingSettings, type StockSetupGap } from "@/lib/stock/setup";
import { STOCKS, STOCK_SLUGS, type StockSlug } from "@/lib/stock/stocks";
import { CATEGORIES } from "@/lib/domain/categories";
import { categoryGroup } from "@/lib/server/stock-product-guard";

export interface StockGroupSettings {
  id: string;
  name: string;
  category: DrinkCategory | null;
  stockAccount: string | null;
  consumptionAccount: string | null;
  lossAccount: string | null;
  countDiffAccount: string | null;
  products: number;
}

export interface StockSettingsView extends StockBookingSettings {
  expiryLeadDays: number | null;
  consumptionCostCenterId: string | null;
  purchaseCostCenterId: string | null;
  lossCostCenterId: string | null;
  countDiffCostCenterId: string | null;
  boardCostCenterId: string | null;
  boardSalesCostCenterId: string | null;
  voucherSeries: string | null;
  groups: StockGroupSettings[];
  /** What is still to choose before a day can be posted. */
  gaps: StockSetupGap[];
}

export async function getStockSettings(stock: StockSlug): Promise<StockSettingsView> {
  // Where the drink type is filed, every drink type has its accounts, so each one is there to fill in.
  if (STOCKS[stock].filesRestaurangrapport) {
    for (const c of CATEGORIES) await categoryGroup(stock, c);
  }
  const row = await prisma.stock.findUniqueOrThrow({
    where: { id: stock },
    include: {
      groups: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: { _count: { select: { products: true } } },
      },
    },
  });
  const settings = {
    stock,
    purchaseMode: row.purchaseMode,
    expiryLeadDays: row.expiryLeadDays,
    consumptionCostCenterId: row.consumptionCostCenterId,
    purchaseOffsetAccount: row.purchaseOffsetAccount,
    purchaseCostCenterId: row.purchaseCostCenterId,
    lossCostCenterId: row.lossCostCenterId,
    countDiffCostCenterId: row.countDiffCostCenterId,
    boardCostAccount: row.boardCostAccount,
    boardCostCenterId: row.boardCostCenterId,
    boardSalesAccount: row.boardSalesAccount,
    boardSalesCostCenterId: row.boardSalesCostCenterId,
    voucherSeries: row.voucherSeries,
    postingStartsOn: row.postingStartsOn ? isoDay(row.postingStartsOn) : null,
    groups: row.groups.map((g) => ({
      id: g.id,
      name: g.name,
      category: g.category,
      stockAccount: g.stockAccount,
      consumptionAccount: g.consumptionAccount,
      lossAccount: g.lossAccount,
      countDiffAccount: g.countDiffAccount,
      products: g._count.products,
    })),
  };
  return { ...settings, gaps: postingGaps(settings) };
}

/** Every stock's settings, in nav order. */
export const getAllStockSettings = (): Promise<StockSettingsView[]> =>
  Promise.all(STOCK_SLUGS.map(getStockSettings));

/** A place as Inställningar -> Lager edits it. */
export interface StockPlaceSettings {
  id: string;
  stock: StockSlug;
  name: string;
  costCenterId: string | null;
  archived: boolean;
  /** The Authentik groups whose members may log moves to and from it. */
  groups: string[];
  /** How many active members hold one of those groups now. */
  holders: number;
  /** Rows in the log that name it. A place with none may be deleted; one with some is archived. */
  movements: number;
}

/** Every stock's places, archived ones last, and every section group anybody holds, to pick from. */
export async function getPlaceSettings(): Promise<{
  places: StockPlaceSettings[];
  knownGroups: string[];
}> {
  const [places, users] = await Promise.all([
    prisma.stockPlace.findMany({
      orderBy: [{ archived: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        stockId: true,
        name: true,
        costCenterId: true,
        archived: true,
        groups: { select: { group: true }, orderBy: { group: "asc" } },
        _count: { select: { entries: true } },
      },
    }),
    prisma.user.findMany({
      where: { active: true, stockPlaceIds: { isEmpty: false } },
      select: { stockPlaceIds: true },
    }),
  ]);
  const holders = new Map<string, number>();
  for (const u of users) {
    for (const id of u.stockPlaceIds) holders.set(id, (holders.get(id) ?? 0) + 1);
  }
  const knownGroups = await getKnownGroups();

  return {
    places: places.flatMap((p) =>
      (STOCK_SLUGS as readonly string[]).includes(p.stockId)
        ? [
            {
              id: p.id,
              stock: p.stockId as StockSlug,
              name: p.name,
              costCenterId: p.costCenterId,
              archived: p.archived,
              groups: p.groups.map((g) => g.group),
              holders: holders.get(p.id) ?? 0,
              movements: p._count.entries,
            },
          ]
        : [],
    ),
    knownGroups,
  };
}
